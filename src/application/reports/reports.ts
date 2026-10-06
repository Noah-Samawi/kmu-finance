// Modul D: Protokolle, Abschlüsse, Exporte
import { aliasedTable, and, asc, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { Tx } from "@/infrastructure/db/client";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { invoices, ledgerEntries, periodClosings, receipts, users, type LedgerType } from "@/infrastructure/db/schema";
import { conflict, rule } from "@/domain/errors";
import { dayRange, monthKey, monthRange, todayKey } from "@/domain/period";
import { requireRole, tid, type Ctx } from "../context";
import { audit, poolBalance, walletBalance } from "../ledger-service";

export interface Range { start: Date; end: Date }

/** Von/Bis als Kalendertage (inklusive) -> halboffenes UTC-Intervall */
export function rangeFromDays(from: string, to: string): Range {
  if (from > to) throw rule("'Von' liegt nach 'Bis'");
  return { start: dayRange(from).start, end: dayRange(to).end };
}

const reversed = aliasedTable(ledgerEntries, "reversed");

export interface LedgerRow {
  id: string; type: LedgerType; bookingDate: Date;
  poolDeltaCents: number; walletDeltaCents: number; description: string | null;
  employeeId: string | null; employeeName: string | null;
  receiptId: string | null; receiptMerchant: string | null; receiptStatus: "SUBMITTED" | "APPROVED" | "REJECTED" | null;
  invoiceId: string | null; invoiceNumber: string | null;
  reversalOfId: string | null; reversedType: LedgerType | null; closingId: string | null;
}

/** Buchungsliste mit Klartext-Infos (Mitarbeiter, Beleg, Rechnung) */
export async function ledgerRows(tx: Tx, tenantId: string, opts: { range?: Range; employeeId?: string; limit?: number } = {}): Promise<LedgerRow[]> {
  return tx.select({
    id: ledgerEntries.id, type: ledgerEntries.type, bookingDate: ledgerEntries.bookingDate,
    poolDeltaCents: ledgerEntries.poolDeltaCents, walletDeltaCents: ledgerEntries.walletDeltaCents,
    description: ledgerEntries.description, employeeId: ledgerEntries.employeeId, employeeName: users.name,
    receiptId: ledgerEntries.receiptId, receiptMerchant: receipts.merchant, receiptStatus: receipts.status,
    invoiceId: ledgerEntries.invoiceId, invoiceNumber: invoices.number,
    reversalOfId: ledgerEntries.reversalOfId, reversedType: reversed.type, closingId: ledgerEntries.closingId,
  }).from(ledgerEntries)
    .leftJoin(users, eq(users.id, ledgerEntries.employeeId))
    .leftJoin(receipts, eq(receipts.id, ledgerEntries.receiptId))
    .leftJoin(invoices, eq(invoices.id, ledgerEntries.invoiceId))
    .leftJoin(reversed, eq(reversed.id, ledgerEntries.reversalOfId))
    .where(and(
      eq(ledgerEntries.tenantId, tenantId),
      opts.employeeId ? eq(ledgerEntries.employeeId, opts.employeeId) : undefined,
      opts.range ? gte(ledgerEntries.bookingDate, opts.range.start) : undefined,
      opts.range ? lt(ledgerEntries.bookingDate, opts.range.end) : undefined,
    ))
    .orderBy(desc(ledgerEntries.bookingDate), desc(ledgerEntries.createdAt))
    .limit(opts.limit ?? 5000);
}

/** Storno wird dem Typ der Originalbuchung zugerechnet -> Summen sind netto korrekt */
const effType = (r: LedgerRow): LedgerType => (r.type === "REVERSAL" ? r.reversedType ?? "REVERSAL" : r.type);

export interface EmployeeSummary {
  employeeId: string; name: string;
  openingCents: number; allocatedCents: number; receiptsCents: number;
  adjustmentsCents: number; returnedCents: number; closingCents: number;
}

export interface Summary {
  from: string; to: string;
  pool: { openingCents: number; incomeInvoiceCents: number; incomeManualCents: number; allocatedCents: number; returnedCents: number; closingCents: number };
  totals: { receiptsCents: number; adjustmentsCents: number; walletsOpenCents: number };
  employees: EmployeeSummary[];
  entryCount: number;
}

/**
 * Kernauswertung für einen Zeitraum.
 * Admin: alles. Mitarbeiter: nur eigene Zeile, keine Pool-Zahlen.
 */
export async function buildSummary(tx: Tx, tenantId: string, range: Range, fromKey: string, toKey: string, onlyEmployeeId?: string): Promise<Summary> {
  const rows = await ledgerRows(tx, tenantId, { range, employeeId: onlyEmployeeId, limit: 100_000 });
  const sumPool = (t: LedgerType) => rows.filter((r) => effType(r) === t).reduce((s, r) => s + r.poolDeltaCents, 0);
  // "+ 0" normalisiert -0 zu 0 (sonst Anzeige "-0,00 €")
  const sumWallet = (t: LedgerType, emp?: string) =>
    rows.filter((r) => effType(r) === t && (!emp || r.employeeId === emp)).reduce((s, r) => s + r.walletDeltaCents, 0) + 0;
  const neg = (v: number) => (v === 0 ? 0 : -v);

  const empList = onlyEmployeeId
    ? await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, onlyEmployeeId))
    : await tx.select({ id: users.id, name: users.name }).from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.role, "EMPLOYEE"))).orderBy(asc(users.name));

  const employees: EmployeeSummary[] = [];
  for (const e of empList) {
    const opening = await walletBalance(tx, tenantId, e.id, range.start);
    const s: EmployeeSummary = {
      employeeId: e.id, name: e.name, openingCents: opening,
      allocatedCents: sumWallet("ALLOCATION", e.id),
      receiptsCents: neg(sumWallet("RECEIPT", e.id)),
      adjustmentsCents: neg(sumWallet("ADJUSTMENT", e.id)),
      returnedCents: neg(sumWallet("RETURN", e.id)),
      closingCents: 0,
    };
    s.closingCents = s.openingCents + s.allocatedCents - s.receiptsCents - s.adjustmentsCents - s.returnedCents;
    if (onlyEmployeeId || s.openingCents || s.closingCents || s.allocatedCents || s.receiptsCents || s.adjustmentsCents || s.returnedCents) {
      employees.push(s);
    }
  }

  const poolOpening = onlyEmployeeId ? 0 : await poolBalance(tx, tenantId, range.start);
  const pool = {
    openingCents: poolOpening,
    incomeInvoiceCents: onlyEmployeeId ? 0 : sumPool("INCOME_INVOICE"),
    incomeManualCents: onlyEmployeeId ? 0 : sumPool("INCOME_MANUAL"),
    allocatedCents: onlyEmployeeId ? 0 : neg(sumPool("ALLOCATION")),
    returnedCents: onlyEmployeeId ? 0 : sumPool("RETURN"),
    closingCents: 0,
  };
  pool.closingCents = pool.openingCents + pool.incomeInvoiceCents + pool.incomeManualCents - pool.allocatedCents + pool.returnedCents;

  return {
    from: fromKey, to: toKey, pool,
    totals: {
      receiptsCents: employees.reduce((s, e) => s + e.receiptsCents, 0),
      adjustmentsCents: employees.reduce((s, e) => s + e.adjustmentsCents, 0),
      walletsOpenCents: employees.reduce((s, e) => s + e.closingCents, 0),
    },
    employees,
    entryCount: rows.length,
  };
}

/** Buchungsjournal mit Filtern. Mitarbeiter sehen nur ihr eigenes Konto. */
export async function listLedger(ctx: Ctx, f: { from?: string; to?: string; employeeId?: string } = {}) {
  requireRole(ctx, "ADMIN", "EMPLOYEE");
  const tenantId = tid(ctx);
  const range = f.from && f.to ? rangeFromDays(f.from, f.to) : undefined;
  const employeeId = ctx.role === "EMPLOYEE" ? ctx.userId : f.employeeId;
  return withTenant(ctx, (tx) => ledgerRows(tx, tenantId, { range, employeeId, limit: 1000 }));
}

export async function getSummary(ctx: Ctx, from: string, to: string, employeeId?: string) {
  requireRole(ctx, "ADMIN", "EMPLOYEE");
  const tenantId = tid(ctx);
  const range = rangeFromDays(from, to);
  const only = ctx.role === "EMPLOYEE" ? ctx.userId : employeeId;
  return withTenant(ctx, async (tx) => ({
    summary: await buildSummary(tx, tenantId, range, from, to, only),
    entries: await ledgerRows(tx, tenantId, { range, employeeId: only, limit: 2000 }),
  }));
}

/** Tages- oder Monatsabschluss. Monatsabschluss sperrt alle Buchungen des Monats. */
export async function closePeriod(ctx: Ctx, periodType: "DAY" | "MONTH", period: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const { start, end } = periodType === "DAY" ? dayRange(period) : monthRange(period);
  if (periodType === "DAY" && period > todayKey()) throw rule("Zukünftige Tage können nicht abgeschlossen werden");
  if (periodType === "MONTH" && period >= monthKey()) throw rule("Ein Monat kann erst nach Monatsende abgeschlossen werden");
  const lastDay = new Date(end.getTime() - 1);

  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const exists = await tx.query.periodClosings.findFirst({
      where: and(eq(periodClosings.tenantId, tenantId), eq(periodClosings.periodType, periodType), eq(periodClosings.periodStart, start)),
    });
    if (exists) throw conflict("Dieser Zeitraum wurde bereits abgeschlossen");
    const fromKey = periodType === "DAY" ? period : `${period}-01`;
    const toKey = periodType === "DAY" ? period : todayKey(lastDay);
    const totals = await buildSummary(tx, tenantId, { start, end }, fromKey, toKey);
    const [c] = await tx.insert(periodClosings).values({
      tenantId, periodType, periodStart: start, periodEnd: end, totals, closedById: ctx.userId,
    }).returning();
    if (periodType === "MONTH") {
      const ids = (await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(
        eq(ledgerEntries.tenantId, tenantId), gte(ledgerEntries.bookingDate, start),
        lt(ledgerEntries.bookingDate, end), isNull(ledgerEntries.closingId),
      ))).map((r) => r.id);
      if (ids.length) await tx.update(ledgerEntries).set({ closingId: c.id }).where(inArray(ledgerEntries.id, ids));
    }
    await audit(tx, ctx, "period.closed", "PeriodClosing", c.id, { periodType, period });
    return c;
  });
}

export async function listClosings(ctx: Ctx) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, (tx) =>
    tx.select({
      id: periodClosings.id, periodType: periodClosings.periodType, periodStart: periodClosings.periodStart,
      periodEnd: periodClosings.periodEnd, closedAt: periodClosings.closedAt, totals: periodClosings.totals,
      closedByName: users.name,
    }).from(periodClosings)
      .leftJoin(users, eq(users.id, periodClosings.closedById))
      .where(eq(periodClosings.tenantId, tenantId))
      .orderBy(desc(periodClosings.periodStart)).limit(200),
  );
}
