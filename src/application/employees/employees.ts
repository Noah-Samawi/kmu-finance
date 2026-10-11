// Admin: Mitarbeiter anlegen, sperren, Passwort zurücksetzen
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { users } from "@/infrastructure/db/schema";
import { destroyAllSessionsOfUser, hashPassword } from "@/infrastructure/auth/session";
import { conflict } from "@/domain/errors";
import { employeeCreateSchema, employeeUpdateSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import { audit, claimBalance, claimBalancesByEmployee, loadEmployee, walletBalance, walletBalancesByEmployee } from "../ledger-service";

const publicCols = {
  id: users.id, name: users.name, email: users.email, isActive: users.isActive,
  canEnterCashExpense: users.canEnterCashExpense, canEnterOutlay: users.canEnterOutlay,
  lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
};

export async function listEmployees(ctx: Ctx) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const list = await tx.select(publicCols).from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "EMPLOYEE")))
      .orderBy(asc(users.name));
    const balances = await walletBalancesByEmployee(tx, tenantId);
    const claims = await claimBalancesByEmployee(tx, tenantId);
    return list.map((e) => {
      const wallet = balances.get(e.id) ?? 0;
      const claim = claims.get(e.id) ?? 0;
      return { ...e, balanceCents: wallet, claimCents: claim, firmBalanceCents: claim - wallet };
    });
  });
}

export async function getEmployee(ctx: Ctx, employeeId: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const e = await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const wallet = await walletBalance(tx, tenantId, e.id);
    const claim = await claimBalance(tx, tenantId, e.id);
    return {
      id: e.id, name: e.name, email: e.email, isActive: e.isActive,
      canEnterCashExpense: e.canEnterCashExpense, canEnterOutlay: e.canEnterOutlay,
      lastLoginAt: e.lastLoginAt,
      createdAt: e.createdAt, balanceCents: wallet, claimCents: claim, firmBalanceCents: claim - wallet,
    };
  });
}

export async function createEmployee(ctx: Ctx, input: z.infer<typeof employeeCreateSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    if (await tx.query.users.findFirst({ where: eq(users.email, input.email) })) {
      throw conflict("E-Mail ist bereits registriert");
    }
    const [u] = await tx.insert(users).values({
      tenantId, role: "EMPLOYEE", name: input.name, email: input.email,
      passwordHash: await hashPassword(input.password),
    }).returning(publicCols);
    await audit(tx, ctx, "employee.created", "User", u.id);
    return u;
  });
}

/** Sperren beendet alle laufenden Sessions sofort */
export async function updateEmployee(ctx: Ctx, employeeId: string, input: z.infer<typeof employeeUpdateSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const result = await withTenant(ctx, async (tx) => {
    await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    if (input.canEnterCashExpense !== undefined) patch.canEnterCashExpense = input.canEnterCashExpense;
    if (input.canEnterOutlay !== undefined) patch.canEnterOutlay = input.canEnterOutlay;
    if (input.password) patch.passwordHash = await hashPassword(input.password);
    const [u] = await tx.update(users).set(patch).where(eq(users.id, employeeId)).returning(publicCols);
    await audit(tx, ctx, input.isActive === false ? "employee.locked" : input.isActive ? "employee.unlocked" : "employee.updated",
      "User", employeeId, { passwordReset: !!input.password });
    return u;
  });
  if (input.isActive === false || input.password) await destroyAllSessionsOfUser(employeeId);
  return result;
}
