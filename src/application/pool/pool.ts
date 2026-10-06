// Modul B: Einnahmen-Pool & Budget-Zuteilung
import { z } from "zod";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { rule } from "@/domain/errors";
import { deltasFor } from "@/domain/ledger";
import { dateInputToDate, todayKey } from "@/domain/period";
import { allocationSchema, incomeSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import { audit, insertEntry, insufficient, loadEmployee, poolBalance, walletBalance } from "../ledger-service";
import { ledgerRows } from "../reports/reports";

/** Pool-Übersicht: Rest-Kassenbestand + letzte Pool-Bewegungen */
export async function poolOverview(ctx: Ctx) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const rows = await ledgerRows(tx, tenantId, { limit: 300 });
    return {
      poolBalanceCents: await poolBalance(tx, tenantId),
      entries: rows.filter((r) => r.poolDeltaCents !== 0).slice(0, 100),
    };
  });
}

/** Manuelle Einnahme (z. B. Barverkauf, Tageskasse) */
export async function recordIncome(ctx: Ctx, input: z.infer<typeof incomeSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  if (input.bookingDate && input.bookingDate > todayKey()) throw rule("Buchungsdatum darf nicht in der Zukunft liegen");
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "INCOME_MANUAL", ...deltasFor("INCOME_MANUAL", input.amountCents),
      description: input.description,
      bookingDate: input.bookingDate && input.bookingDate !== todayKey() ? dateInputToDate(input.bookingDate) : new Date(),
    });
    await audit(tx, ctx, "pool.income", "LedgerEntry", entry.id, { amountCents: input.amountCents });
    return { entry, poolBalanceCents: await poolBalance(tx, tenantId) };
  });
}

/**
 * Budget aus dem Pool an einen Mitarbeiter.
 * Regel: Rest-Kassenbestand darf nicht negativ werden.
 */
export async function allocateBudget(ctx: Ctx, input: z.infer<typeof allocationSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const emp = await loadEmployee(tx, tenantId, input.employeeId);
    const pool = await poolBalance(tx, tenantId);
    if (pool < input.amountCents) throw insufficient("Freier Kassenbestand", pool);
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "ALLOCATION", ...deltasFor("ALLOCATION", input.amountCents),
      employeeId: emp.id, description: input.description || `Budget für ${emp.name}`,
    });
    await audit(tx, ctx, "pool.allocation", "LedgerEntry", entry.id, { employeeId: emp.id, amountCents: input.amountCents });
    return {
      entry,
      poolBalanceCents: await poolBalance(tx, tenantId),
      walletBalanceCents: await walletBalance(tx, tenantId, emp.id),
    };
  });
}
