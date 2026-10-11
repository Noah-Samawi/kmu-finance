import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { users } from "@/infrastructure/db/schema";
import { destroyAllSessionsOfUser, hashPassword } from "@/infrastructure/auth/session";
import { conflict, rule } from "@/domain/errors";
import { ACCOUNT_LABEL } from "@/domain/accounts";
import { deltasFor } from "@/domain/ledger";
import { partnerBookSchema, partnerCreateSchema, partnerUpdateSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import {
  accountBalance, audit, insertEntry, insufficient, loadPartner, partnerBalance, partnerBalancesByPartner,
} from "../ledger-service";
import { ledgerRows } from "../reports/reports";

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
    const balances = await partnerBalancesByPartner(tx, tenantId);
    return list.map((p) => ({ ...p, capitalCents: balances.get(p.id) ?? 0 }));
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

export async function bookPartner(ctx: Ctx, partnerId: string, input: z.infer<typeof partnerBookSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const account = input.accountKind ?? "BANK";
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const p = await loadPartner(tx, tenantId, partnerId);
    if (input.type === "PARTNER_DRAW") {
      const avail = await accountBalance(tx, tenantId, account);
      if (avail < input.amountCents) throw insufficient(ACCOUNT_LABEL[account], avail);
      const cap = await partnerBalance(tx, tenantId, partnerId);
      if (cap < input.amountCents) throw insufficient("Kapitalkonto", cap);
    }
    const d = input.type === "PARTNER_PROFIT"
      ? { ...deltasFor("PARTNER_PROFIT", input.amountCents, account), cashDeltaCents: 0, bankDeltaCents: 0, poolDeltaCents: 0, accountKind: null }
      : deltasFor(input.type, input.amountCents, account);
    if (input.type === "PARTNER_DEPOSIT") {
      // Einlage erhöht Kasse/Bank
    }
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: input.type, ...d, employeeId: p.id,
      description: `${input.description} · ${ACCOUNT_LABEL[account]}`,
    });
    await audit(tx, ctx, "partner.book", "LedgerEntry", entry.id, { partnerId, type: input.type });
    return { entry, capitalCents: await partnerBalance(tx, tenantId, partnerId) };
  });
}
