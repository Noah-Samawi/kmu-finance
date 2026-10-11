import { z } from "zod";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { rule } from "@/domain/errors";
import { ACCOUNT_LABEL } from "@/domain/accounts";
import { deltasFor } from "@/domain/ledger";
import { dateInputToDate, todayKey } from "@/domain/period";
import { accountAdjustSchema, allocationSchema, incomeSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import {
  accountBalance, audit, bankBalance, cashBalance, insertEntry, insufficient, loadEmployee, poolBalance, walletBalance,
} from "../ledger-service";
import { ledgerRows } from "../reports/reports";

export async function poolOverview(ctx: Ctx) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const rows = await ledgerRows(tx, tenantId, { limit: 300 });
    const cashBalanceCents = await cashBalance(tx, tenantId);
    const bankBalanceCents = await bankBalance(tx, tenantId);
    return {
      poolBalanceCents: cashBalanceCents + bankBalanceCents,
      cashBalanceCents,
      bankBalanceCents,
      entries: rows.filter((r) => r.poolDeltaCents !== 0 || r.cashDeltaCents !== 0 || r.bankDeltaCents !== 0).slice(0, 120),
    };
  });
}

export async function recordIncome(ctx: Ctx, input: z.infer<typeof incomeSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  if (input.bookingDate && input.bookingDate > todayKey()) throw rule("Buchungsdatum darf nicht in der Zukunft liegen");
  const account = input.accountKind ?? "CASH";
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "INCOME_MANUAL", ...deltasFor("INCOME_MANUAL", input.amountCents, account),
      description: input.description,
      bookingDate: input.bookingDate && input.bookingDate !== todayKey() ? dateInputToDate(input.bookingDate) : new Date(),
    });
    await audit(tx, ctx, "pool.income", "LedgerEntry", entry.id, { amountCents: input.amountCents, accountKind: account });
    return {
      entry,
      poolBalanceCents: await poolBalance(tx, tenantId),
      cashBalanceCents: await cashBalance(tx, tenantId),
      bankBalanceCents: await bankBalance(tx, tenantId),
    };
  });
}

export async function allocateBudget(ctx: Ctx, input: z.infer<typeof allocationSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const account = input.accountKind ?? "CASH";
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const emp = await loadEmployee(tx, tenantId, input.employeeId);
    const avail = await accountBalance(tx, tenantId, account);
    if (avail < input.amountCents) throw insufficient(ACCOUNT_LABEL[account], avail);
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "ALLOCATION", ...deltasFor("ALLOCATION", input.amountCents, account),
      employeeId: emp.id, description: `${input.description} · aus ${ACCOUNT_LABEL[account]}`,
    });
    await audit(tx, ctx, "pool.allocation", "LedgerEntry", entry.id, { employeeId: emp.id, amountCents: input.amountCents, accountKind: account });
    return {
      entry,
      poolBalanceCents: await poolBalance(tx, tenantId),
      cashBalanceCents: await cashBalance(tx, tenantId),
      bankBalanceCents: await bankBalance(tx, tenantId),
      walletBalanceCents: await walletBalance(tx, tenantId, emp.id),
    };
  });
}

export async function adjustAccount(ctx: Ctx, input: z.infer<typeof accountAdjustSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const account = input.accountKind ?? "CASH";
  const signed = input.amountCents;
  const abs = Math.abs(signed);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const avail = await accountBalance(tx, tenantId, account);
    if (signed < 0 && avail < abs) throw insufficient(ACCOUNT_LABEL[account], avail);
    const base = deltasFor("ACCOUNT_ADJUST", abs, account);
    const d = signed < 0
      ? { ...base, poolDeltaCents: -base.poolDeltaCents, cashDeltaCents: -base.cashDeltaCents, bankDeltaCents: -base.bankDeltaCents }
      : base;
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "ACCOUNT_ADJUST", ...d,
      description: input.description,
    });
    await audit(tx, ctx, "account.adjust", "LedgerEntry", entry.id, { accountKind: account, amountCents: signed });
    return {
      entry,
      cashBalanceCents: await cashBalance(tx, tenantId),
      bankBalanceCents: await bankBalance(tx, tenantId),
    };
  });
}
