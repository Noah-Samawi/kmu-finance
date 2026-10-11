import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { users } from "@/infrastructure/db/schema";
import { destroyAllSessionsOfUser, hashPassword } from "@/infrastructure/auth/session";
import { conflict } from "@/domain/errors";
import { partnerCreateSchema, partnerUpdateSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import {
  audit, claimBalance, claimBalancesByEmployee, loadPartner, partnerBalance, partnerBalancesByPartner,
  walletBalance, walletBalancesByEmployee,
} from "../ledger-service";
import { ledgerRows } from "../reports/reports";
import { partnerBookingRows } from "./partner-bookings";

const publicCols = {
  id: users.id, name: users.name, email: users.email, isActive: users.isActive,
  canViewReports: users.canViewReports, canViewBank: users.canViewBank,
  lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
};

export async function listPartners(ctx: Ctx) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const list = await tx.select(publicCols).from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "PARTNER")))
      .orderBy(asc(users.name));
    const capital = await partnerBalancesByPartner(tx, tenantId);
    const outlays = await claimBalancesByEmployee(tx, tenantId);
    const budgets = await walletBalancesByEmployee(tx, tenantId);
    const bookings = await partnerBookingRows(tx, tenantId, { limit: 2000 });
    return list.map((p) => ({
      ...p,
      capitalCents: capital.get(p.id) ?? 0,
      outlayOpenCents: outlays.get(p.id) ?? 0,
      budgetCents: budgets.get(p.id) ?? 0,
      bookings: bookings.filter((b) => b.partnerId === p.id),
    }));
  });
}

export async function getPartner(ctx: Ctx, partnerId: string) {
  if (ctx.role === "PARTNER") partnerId = ctx.userId;
  else requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const p = ctx.role === "ADMIN"
      ? await loadPartner(tx, tenantId, partnerId, { requireActive: false })
      : (await tx.query.users.findFirst({ where: eq(users.id, ctx.userId) }))!;
    return {
      id: p.id, name: p.name, email: p.email, isActive: p.isActive,
      canViewReports: p.canViewReports, canViewBank: p.canViewBank,
      capitalCents: await partnerBalance(tx, tenantId, p.id),
      outlayOpenCents: await claimBalance(tx, tenantId, p.id),
      budgetCents: await walletBalance(tx, tenantId, p.id),
      bookings: await partnerBookingRows(tx, tenantId, { partnerId: p.id, limit: 500 }),
      entries: await ledgerRows(tx, tenantId, { employeeId: p.id, limit: 200 }),
    };
  });
}

export async function createPartner(ctx: Ctx, input: z.infer<typeof partnerCreateSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    if (await tx.query.users.findFirst({ where: eq(users.email, input.email) })) {
      throw conflict("E-Mail ist bereits registriert");
    }
    const [u] = await tx.insert(users).values({
      tenantId, role: "PARTNER", name: input.name, email: input.email,
      passwordHash: await hashPassword(input.password),
      canViewReports: input.canViewReports, canViewBank: input.canViewBank,
      canEnterCashExpense: false, canEnterOutlay: false,
    }).returning(publicCols);
    await audit(tx, ctx, "partner.created", "User", u.id);
    return u;
  });
}

export async function updatePartner(ctx: Ctx, partnerId: string, input: z.infer<typeof partnerUpdateSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const result = await withTenant(ctx, async (tx) => {
    await loadPartner(tx, tenantId, partnerId, { requireActive: false });
    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    if (input.canViewReports !== undefined) patch.canViewReports = input.canViewReports;
    if (input.canViewBank !== undefined) patch.canViewBank = input.canViewBank;
    if (input.password) patch.passwordHash = await hashPassword(input.password);
    const [u] = await tx.update(users).set(patch).where(eq(users.id, partnerId)).returning(publicCols);
    await audit(tx, ctx, "partner.updated", "User", partnerId);
    return u;
  });
  if (input.isActive === false || input.password) await destroyAllSessionsOfUser(partnerId);
  return result;
}
