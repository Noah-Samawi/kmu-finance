// Gesellschafter-Vorgänge: Mittelherkunft, Begründung, Verrechnungskonto "Vorgelegtes Geld",
// gezielte Auslagen-Erstattung. Alles append-only, Korrektur nur per Storno.
import { aliasedTable, and, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/infrastructure/db/client";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { ledgerEntries, partnerBookings, partnerOutlayRefunds, users } from "@/infrastructure/db/schema";
import { storage } from "@/infrastructure/storage";
import { forbidden, isAppError, notFound, rule } from "@/domain/errors";
import {
  FUNDING_LABEL, PARTNER_KIND_LABEL, allowedSources, assertPurpose, isPurchase, isRefundable, partnerPosting, refundStatus, validateRefundAllocation,
  type FundingSource, type PartnerKind, type RefundStatus,
} from "@/domain/partner";
import { dateInputToDate, todayKey } from "@/domain/period";
import { assertCategory, categoryLabel } from "@/domain/cash";
import { partnerBookSchema, partnerRefundSchema, partnerSelfBookSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import {
  audit, bankBalance, cashBalance, claimBalance, insertEntry, insufficient, loadPartner, partnerBalance, walletBalance,
} from "../ledger-service";
import { parseReceiptDataUrl } from "../receipts/inline-file";
import { storeReceiptFile, type UploadFile } from "../receipts/store-file";
import type { Range } from "../reports/reports";

export interface PartnerBookingRow {
  id: string;
  partnerId: string;
  partnerName: string;
  kind: PartnerKind;
  source: FundingSource | null;
  amountCents: number;
  purpose: string;
  hasReceipt: boolean;
  bookingDate: Date;
  createdByName: string;
  /** vom Gesellschafter selbst erfasst (sonst durch die Geschäftsführung) */
  selfEntered: boolean;
  ledgerEntryId: string;
  reversed: boolean;
  refundable: boolean;
  refundedCents: number;
  openCents: number;
  status: RefundStatus | null;
  /** Bei Erstattungen: welche Auslagen damit getilgt wurden */
  settles: { outlayId: string; amountCents: number; purpose: string; bookingDate: Date }[];
}

const creator = aliasedTable(users, "creator");
const reversal = aliasedTable(ledgerEntries, "reversal");
const refundBooking = aliasedTable(partnerBookings, "refund_booking");
const refundReversal = aliasedTable(ledgerEntries, "refund_reversal");
const outlayBooking = aliasedTable(partnerBookings, "outlay_booking");

/** Gesellschafter-Vorgänge inkl. Erstattungsstatus (Stand: jetzt) */
export async function partnerBookingRows(
  tx: Tx, tenantId: string, opts: { partnerId?: string; range?: Range; limit?: number } = {},
): Promise<PartnerBookingRow[]> {
  const rows = await tx.select({
    id: partnerBookings.id, partnerId: partnerBookings.partnerId, partnerName: users.name,
    kind: partnerBookings.kind, source: partnerBookings.source, amountCents: partnerBookings.amountCents,
    purpose: partnerBookings.purpose, receiptKey: partnerBookings.receiptKey, bookingDate: partnerBookings.bookingDate,
    createdById: partnerBookings.createdById, createdByName: creator.name,
    ledgerEntryId: partnerBookings.ledgerEntryId, reversalId: reversal.id,
  }).from(partnerBookings)
    .innerJoin(users, eq(users.id, partnerBookings.partnerId))
    .innerJoin(creator, eq(creator.id, partnerBookings.createdById))
    .leftJoin(reversal, eq(reversal.reversalOfId, partnerBookings.ledgerEntryId))
    .where(and(
      eq(partnerBookings.tenantId, tenantId),
      opts.partnerId ? eq(partnerBookings.partnerId, opts.partnerId) : undefined,
      opts.range ? gte(partnerBookings.bookingDate, opts.range.start) : undefined,
      opts.range ? lt(partnerBookings.bookingDate, opts.range.end) : undefined,
    ))
    .orderBy(desc(partnerBookings.bookingDate), desc(partnerBookings.createdAt))
    .limit(opts.limit ?? 5000);
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  // Nur Zuordnungen aus nicht stornierten Erstattungen zählen
  const allocations = await tx.select({
    outlayId: partnerOutlayRefunds.outlayBookingId, refundId: partnerOutlayRefunds.refundBookingId,
    amountCents: partnerOutlayRefunds.amountCents,
    outlayPurpose: outlayBooking.purpose, outlayDate: outlayBooking.bookingDate,
  }).from(partnerOutlayRefunds)
    .innerJoin(refundBooking, eq(refundBooking.id, partnerOutlayRefunds.refundBookingId))
    .innerJoin(outlayBooking, eq(outlayBooking.id, partnerOutlayRefunds.outlayBookingId))
    .leftJoin(refundReversal, eq(refundReversal.reversalOfId, refundBooking.ledgerEntryId))
    .where(and(
      eq(partnerOutlayRefunds.tenantId, tenantId),
      isNull(refundReversal.id),
      or(inArray(partnerOutlayRefunds.outlayBookingId, ids), inArray(partnerOutlayRefunds.refundBookingId, ids)),
    ));

  const refunded = new Map<string, number>();
  const settles = new Map<string, PartnerBookingRow["settles"]>();
  for (const a of allocations) {
    refunded.set(a.outlayId, (refunded.get(a.outlayId) ?? 0) + a.amountCents);
    const list = settles.get(a.refundId) ?? [];
    list.push({ outlayId: a.outlayId, amountCents: a.amountCents, purpose: a.outlayPurpose, bookingDate: a.outlayDate });
    settles.set(a.refundId, list);
  }

  return rows.map((r) => {
    const refundable = isRefundable(r.kind, r.source);
    const reversed = !!r.reversalId;
    const refundedCents = refunded.get(r.id) ?? 0;
    const openCents = refundable && !reversed ? Math.max(0, r.amountCents - refundedCents) : 0;
    return {
      id: r.id, partnerId: r.partnerId, partnerName: r.partnerName, kind: r.kind, source: r.source,
      amountCents: r.amountCents, purpose: r.purpose, hasReceipt: !!r.receiptKey, bookingDate: r.bookingDate,
      createdByName: r.createdByName, selfEntered: r.createdById === r.partnerId,
      ledgerEntryId: r.ledgerEntryId, reversed, refundable, refundedCents, openCents,
      status: refundable && !reversed ? refundStatus(r.amountCents, refundedCents) : null,
      settles: settles.get(r.id) ?? [],
    };
  });
}

interface BookingInput {
  kind: PartnerKind;
  source?: FundingSource | null;
  amountCents: number;
  purpose: string;
  bookingDate?: string;
  receipt?: { key: string; mime: string; name: string } | null;
  category?: string | null;
}

async function book(tx: Tx, ctx: Ctx, tenantId: string, partnerId: string, input: BookingInput) {
  if (input.bookingDate && input.bookingDate > todayKey()) throw rule("Buchungsdatum darf nicht in der Zukunft liegen");
  const { type, deltas } = partnerPosting(input.kind, input.source ?? null, input.amountCents);
  const source = allowedSources(input.kind) === null ? null : input.source ?? null;

  await lockTenantLedger(tx, tenantId);
  if (deltas.cashDeltaCents < 0) {
    const avail = await cashBalance(tx, tenantId);
    if (avail + deltas.cashDeltaCents < 0) throw insufficient("Kassenbestand", avail);
  }
  if (deltas.bankDeltaCents < 0) {
    const avail = await bankBalance(tx, tenantId);
    if (avail + deltas.bankDeltaCents < 0) throw insufficient("Bankkonto", avail);
  }
  if (deltas.partnerDeltaCents < 0) {
    const cap = await partnerBalance(tx, tenantId, partnerId);
    if (cap + deltas.partnerDeltaCents < 0) throw insufficient("Kapitalkonto", cap);
  }
  if (deltas.walletDeltaCents < 0) {
    const w = await walletBalance(tx, tenantId, partnerId);
    if (w + deltas.walletDeltaCents < 0) throw insufficient("Budget / Vorschuss", w);
  }

  const category = isPurchase(input.kind) ? assertCategory(input.category) : null;
  const bookingDate = input.bookingDate ? dateInputToDate(input.bookingDate) : new Date();
  const entry = await insertEntry(tx, ctx, tenantId, {
    type, ...deltas, employeeId: partnerId, bookingDate, category,
    description: [
      PARTNER_KIND_LABEL[input.kind], source && FUNDING_LABEL[source], category && categoryLabel(category), input.purpose.trim(),
    ].filter(Boolean).join(" · "),
  });
  const [b] = await tx.insert(partnerBookings).values({
    tenantId, partnerId, kind: input.kind, source, amountCents: input.amountCents, purpose: input.purpose.trim(),
    receiptKey: input.receipt?.key ?? null, receiptMime: input.receipt?.mime ?? null, receiptName: input.receipt?.name ?? null,
    bookingDate, ledgerEntryId: entry.id, createdById: ctx.userId,
  }).returning();
  await audit(tx, ctx, "partner.booking", "PartnerBooking", b.id, {
    partnerId, kind: input.kind, source, amountCents: input.amountCents, ledgerEntryId: entry.id, receipt: !!input.receipt, category,
  });
  return b;
}

async function balances(tx: Tx, tenantId: string, partnerId: string) {
  return {
    capitalCents: await partnerBalance(tx, tenantId, partnerId),
    outlayOpenCents: await claimBalance(tx, tenantId, partnerId),
    budgetCents: await walletBalance(tx, tenantId, partnerId),
  };
}

export async function storePartnerReceipt(tenantId: string, partnerId: string, file: UploadFile) {
  return storeReceiptFile(tenantId, `partner-receipts/${partnerId}`, file);
}

/** Gesellschafter erfasst selbst: Einlage, Auslage oder Entnahme – Mittelherkunft Pflicht */
export async function selfBookPartner(
  ctx: Ctx, input: z.infer<typeof partnerSelfBookSchema>, file?: { data: Buffer; mime: string; name: string } | null,
) {
  requireRole(ctx, "PARTNER");
  const tenantId = tid(ctx);
  assertPurpose(input.purpose, !!file);
  partnerPosting(input.kind, input.source, input.amountCents);
  const receipt = file ? await storePartnerReceipt(tenantId, ctx.userId, file) : null;
  return withTenant(ctx, async (tx) => {
    await loadPartner(tx, tenantId, ctx.userId);
    const booking = await book(tx, ctx, tenantId, ctx.userId, { ...input, receipt });
    return { booking, ...(await balances(tx, tenantId, ctx.userId)) };
  });
}

/** Geschäftsführung bucht für einen Gesellschafter (Einlage, Entnahme, Gewinnanteil, Budget …) */
export async function adminBookPartner(ctx: Ctx, partnerId: string, input: z.infer<typeof partnerBookSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  assertPurpose(input.purpose, true);
  return withTenant(ctx, async (tx) => {
    await loadPartner(tx, tenantId, partnerId);
    const booking = await book(tx, ctx, tenantId, partnerId, input);
    return { booking, ...(await balances(tx, tenantId, partnerId)) };
  });
}

/**
 * Auslagen-Erstattung: Auszahlung aus Bank/Kasse, die ausdrücklich einzelnen
 * offenen Auslagen zugeordnet wird. Nur so sinkt das Konto "Vorgelegtes Geld".
 */
export async function refundPartnerOutlays(ctx: Ctx, partnerId: string, input: z.infer<typeof partnerRefundSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await loadPartner(tx, tenantId, partnerId, { requireActive: false });
    await lockTenantLedger(tx, tenantId);
    const open = (await partnerBookingRows(tx, tenantId, { partnerId }))
      .filter((r) => r.openCents > 0)
      .map((r) => ({ id: r.id, openCents: r.openCents }));
    const total = validateRefundAllocation(open, input.items);
    const claim = await claimBalance(tx, tenantId, partnerId);
    if (claim < total) throw insufficient("Vorgelegtes Geld (offen)", claim);

    const refund = await book(tx, ctx, tenantId, partnerId, {
      kind: "OUTLAY_REFUND", source: input.source, amountCents: total, purpose: input.purpose,
    });
    await tx.insert(partnerOutlayRefunds).values(input.items.map((it) => ({
      tenantId, outlayBookingId: it.outlayId, refundBookingId: refund.id, amountCents: it.amountCents,
    })));
    await audit(tx, ctx, "partner.outlay-refund", "PartnerBooking", refund.id, { partnerId, totalCents: total, items: input.items });
    return { booking: refund, ...(await balances(tx, tenantId, partnerId)) };
  });
}

/** Storno-Schutz: eine (teil-)erstattete Auslage erst nach Storno der Erstattung stornieren */
export async function assertPartnerEntryReversible(tx: Tx, tenantId: string, ledgerEntryId: string) {
  const b = await tx.query.partnerBookings.findFirst({
    where: and(eq(partnerBookings.tenantId, tenantId), eq(partnerBookings.ledgerEntryId, ledgerEntryId)),
  });
  if (!b || b.kind !== "OUTLAY") return;
  const [row] = await partnerBookingRows(tx, tenantId, { partnerId: b.partnerId }).then((rows) => rows.filter((r) => r.id === b.id));
  if (row && row.refundedCents > 0) {
    throw rule("Auslage wurde bereits (teilweise) erstattet – zuerst die Erstattung stornieren");
  }
}

export async function getPartnerBookingReceipt(ctx: Ctx, bookingId: string) {
  requireRole(ctx, "ADMIN", "PARTNER");
  const tenantId = tid(ctx);
  const b = await withTenant(ctx, (tx) => tx.query.partnerBookings.findFirst({
    where: and(eq(partnerBookings.id, bookingId), eq(partnerBookings.tenantId, tenantId)),
  }));
  if (!b || !b.receiptKey) throw notFound("Beleg");
  if (ctx.role === "PARTNER" && b.partnerId !== ctx.userId && !ctx.canViewReports) throw forbidden();
  const inline = parseReceiptDataUrl(b.receiptKey);
  if (inline) return { data: inline.data, mime: inline.mime, name: b.receiptName ?? "beleg" };
  try {
    return { data: await storage.get(b.receiptKey), mime: b.receiptMime ?? "application/octet-stream", name: b.receiptName ?? "beleg" };
  } catch (e) {
    if (isAppError(e)) throw e;
    throw notFound("Belegdatei");
  }
}
