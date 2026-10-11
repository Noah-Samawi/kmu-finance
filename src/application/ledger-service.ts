// Gemeinsame Bausteine für alle Geldbewegungen.
// Jede schreibende Operation läuft so ab:
//   1. lockTenantLedger  (Serialisierung pro Mandant)
//   2. Salden lesen + Regeln prüfen (kein Minus)
//   3. assertPeriodOpen  (abgeschlossener Monat ist gesperrt)
//   4. insertEntry
import { and, eq, lt, sql } from "drizzle-orm";
import type { Tx } from "@/infrastructure/db/client";
import { auditLogs, ledgerEntries, users, type LedgerType } from "@/infrastructure/db/schema";
import { notFound, rule } from "@/domain/errors";
import { formatCents } from "@/domain/money";
import type { Ctx } from "./context";

async function sumCol(
  tx: Tx, tenantId: string,
  col: typeof ledgerEntries.poolDeltaCents | typeof ledgerEntries.cashDeltaCents | typeof ledgerEntries.bankDeltaCents
    | typeof ledgerEntries.claimDeltaCents | typeof ledgerEntries.partnerDeltaCents,
  before?: Date,
) {
  const [r] = await tx
    .select({ v: sql<string>`coalesce(sum(${col}), 0)::bigint` })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.tenantId, tenantId), before ? lt(ledgerEntries.bookingDate, before) : undefined));
  return Number(r.v);
}

export async function poolBalance(tx: Tx, tenantId: string, before?: Date): Promise<number> {
  return sumCol(tx, tenantId, ledgerEntries.poolDeltaCents, before);
}

export async function cashBalance(tx: Tx, tenantId: string, before?: Date): Promise<number> {
  return sumCol(tx, tenantId, ledgerEntries.cashDeltaCents, before);
}

export async function bankBalance(tx: Tx, tenantId: string, before?: Date): Promise<number> {
  return sumCol(tx, tenantId, ledgerEntries.bankDeltaCents, before);
}

export async function accountBalance(tx: Tx, tenantId: string, kind: "CASH" | "BANK", before?: Date): Promise<number> {
  return kind === "CASH" ? cashBalance(tx, tenantId, before) : bankBalance(tx, tenantId, before);
}

async function sumEmployeeCol(
  tx: Tx, tenantId: string, employeeId: string,
  col: typeof ledgerEntries.walletDeltaCents | typeof ledgerEntries.claimDeltaCents | typeof ledgerEntries.partnerDeltaCents,
  before?: Date,
) {
  const [r] = await tx
    .select({ v: sql<string>`coalesce(sum(${col}), 0)::bigint` })
    .from(ledgerEntries)
    .where(and(
      eq(ledgerEntries.tenantId, tenantId),
      eq(ledgerEntries.employeeId, employeeId),
      before ? lt(ledgerEntries.bookingDate, before) : undefined,
    ));
  return Number(r.v);
}

export async function walletBalance(tx: Tx, tenantId: string, employeeId: string, before?: Date): Promise<number> {
  return sumEmployeeCol(tx, tenantId, employeeId, ledgerEntries.walletDeltaCents, before);
}

export async function claimBalance(tx: Tx, tenantId: string, employeeId: string, before?: Date): Promise<number> {
  return sumEmployeeCol(tx, tenantId, employeeId, ledgerEntries.claimDeltaCents, before);
}

export async function partnerBalance(tx: Tx, tenantId: string, partnerId: string, before?: Date): Promise<number> {
  return sumEmployeeCol(tx, tenantId, partnerId, ledgerEntries.partnerDeltaCents, before);
}

/** Salden aller Mitarbeiter eines Mandanten in einer Abfrage */
export async function walletBalancesByEmployee(tx: Tx, tenantId: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      employeeId: ledgerEntries.employeeId,
      v: sql<string>`coalesce(sum(${ledgerEntries.walletDeltaCents}), 0)::bigint`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.tenantId, tenantId))
    .groupBy(ledgerEntries.employeeId);
  return new Map(rows.filter((r) => r.employeeId).map((r) => [r.employeeId!, Number(r.v)]));
}

export async function claimBalancesByEmployee(tx: Tx, tenantId: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      employeeId: ledgerEntries.employeeId,
      v: sql<string>`coalesce(sum(${ledgerEntries.claimDeltaCents}), 0)::bigint`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.tenantId, tenantId))
    .groupBy(ledgerEntries.employeeId);
  return new Map(rows.filter((r) => r.employeeId).map((r) => [r.employeeId!, Number(r.v)]));
}

export async function partnerBalancesByPartner(tx: Tx, tenantId: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      employeeId: ledgerEntries.employeeId,
      v: sql<string>`coalesce(sum(${ledgerEntries.partnerDeltaCents}), 0)::bigint`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.tenantId, tenantId))
    .groupBy(ledgerEntries.employeeId);
  return new Map(rows.filter((r) => r.employeeId).map((r) => [r.employeeId!, Number(r.v)]));
}

export async function assertPeriodOpen(tx: Tx, tenantId: string, at: Date) {
  const r = await tx.execute<{ closed: boolean }>(sql`select period_closed(${tenantId}, ${at.toISOString()}::timestamptz) as closed`);
  if (r.rows[0]?.closed) throw rule("Dieser Monat ist bereits abgeschlossen – keine Buchungen mehr möglich");
}

/** Prüft, dass der Mitarbeiter zum Mandanten gehört und aktiv ist */
export async function loadEmployee(tx: Tx, tenantId: string, employeeId: string, { requireActive = true } = {}) {
  const emp = await tx.query.users.findFirst({
    where: and(eq(users.id, employeeId), eq(users.tenantId, tenantId), eq(users.role, "EMPLOYEE")),
  });
  if (!emp) throw notFound("Mitarbeiter");
  if (requireActive && !emp.isActive) throw rule("Mitarbeiter ist gesperrt");
  return emp;
}

export async function loadPartner(tx: Tx, tenantId: string, partnerId: string, { requireActive = true } = {}) {
  const p = await tx.query.users.findFirst({
    where: and(eq(users.id, partnerId), eq(users.tenantId, tenantId), eq(users.role, "PARTNER")),
  });
  if (!p) throw notFound("Gesellschafter");
  if (requireActive && !p.isActive) throw rule("Gesellschafter ist gesperrt");
  return p;
}

export interface NewEntry {
  type: LedgerType;
  poolDeltaCents: number;
  walletDeltaCents: number;
  cashDeltaCents?: number;
  bankDeltaCents?: number;
  claimDeltaCents?: number;
  partnerDeltaCents?: number;
  accountKind?: "CASH" | "BANK" | null;
  employeeId?: string | null;
  invoiceId?: string | null;
  receiptId?: string | null;
  reversalOfId?: string | null;
  description?: string | null;
  bookingDate?: Date;
}

export async function insertEntry(tx: Tx, ctx: Ctx, tenantId: string, e: NewEntry) {
  const bookingDate = e.bookingDate ?? new Date();
  await assertPeriodOpen(tx, tenantId, bookingDate);
  const cashDeltaCents = e.cashDeltaCents ?? (e.accountKind === "BANK" ? 0 : e.poolDeltaCents);
  const bankDeltaCents = e.bankDeltaCents ?? (e.accountKind === "BANK" ? e.poolDeltaCents : 0);
  const [row] = await tx
    .insert(ledgerEntries)
    .values({
      ...e,
      cashDeltaCents,
      bankDeltaCents,
      claimDeltaCents: e.claimDeltaCents ?? 0,
      partnerDeltaCents: e.partnerDeltaCents ?? 0,
      poolDeltaCents: e.poolDeltaCents || cashDeltaCents + bankDeltaCents,
      bookingDate,
      tenantId,
      createdById: ctx.userId,
    })
    .returning();
  return row;
}

export function insufficient(what: string, available: number) {
  return rule(`${what} reicht nicht aus. Verfügbar: ${formatCents(available)}`);
}

export async function audit(
  tx: Tx, ctx: Ctx, action: string, entity: string, entityId: string, meta?: Record<string, unknown>,
) {
  await tx.insert(auditLogs).values({
    tenantId: ctx.tenantId, actorId: ctx.userId, action, entity, entityId, meta: meta ?? null,
  });
}
