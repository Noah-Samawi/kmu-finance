// Dashboards für Admin und Mitarbeiter
import { and, count, eq } from "drizzle-orm";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { receipts } from "@/infrastructure/db/schema";
import { dayRange, monthKey, monthRange, todayKey } from "@/domain/period";
import { requireRole, tid, type Ctx } from "./context";
import { poolBalance, walletBalance } from "./ledger-service";
import { invoiceStats } from "./invoices/drafts";
import { buildSummary, ledgerRows } from "./reports/reports";

export async function adminDashboard(ctx: Ctx) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const mk = monthKey();
  const m = monthRange(mk);
  return withTenant(ctx, async (tx) => {
    const month = await buildSummary(tx, tenantId, m, `${mk}-01`, todayKey());
    const [pending] = await tx.select({ n: count() }).from(receipts)
      .where(and(eq(receipts.tenantId, tenantId), eq(receipts.status, "SUBMITTED")));
    return {
      poolBalanceCents: await poolBalance(tx, tenantId),
      month: {
        incomeCents: month.pool.incomeInvoiceCents + month.pool.incomeManualCents,
        allocatedCents: month.pool.allocatedCents,
        receiptsCents: month.totals.receiptsCents,
        adjustmentsCents: month.totals.adjustmentsCents,
      },
      walletsOpenCents: month.totals.walletsOpenCents,
      employees: month.employees,
      invoices: await invoiceStats(tx, tenantId),
      pendingReceipts: pending.n,
      recent: await ledgerRows(tx, tenantId, { limit: 10 }),
    };
  });
}

/** Mitarbeiter-Startseite: nur eigenes Konto */
export async function employeeOverview(ctx: Ctx) {
  requireRole(ctx, "EMPLOYEE");
  const tenantId = tid(ctx);
  const tk = todayKey();
  const mk = monthKey();
  return withTenant(ctx, async (tx) => {
    const today = await buildSummary(tx, tenantId, dayRange(tk), tk, tk, ctx.userId);
    const month = await buildSummary(tx, tenantId, monthRange(mk), `${mk}-01`, tk, ctx.userId);
    return {
      balanceCents: await walletBalance(tx, tenantId, ctx.userId),
      today: today.employees[0],
      month: month.employees[0],
      recent: await ledgerRows(tx, tenantId, { employeeId: ctx.userId, limit: 15 }),
    };
  });
}
