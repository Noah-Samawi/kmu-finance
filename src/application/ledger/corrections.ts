// Drei Aktionen je Buchung (Admin): Stornieren, Löschen, Ändern.
//  - Stornieren: GoBD-Gegenbuchung (heute), Original bleibt sichtbar als "storniert".
//  - Löschen:   Gegenbuchung am Buchungstag des Originals; Original + Storno verschwinden aus allen Ansichten,
//               Kontostände sind sofort korrigiert. Im Hauptbuch und Protokoll bleibt alles erhalten.
//  - Ändern:    wie Löschen, zusätzlich eine Ersatzbuchung mit neuem Betrag/Zweck/Filiale am selben Tag.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/infrastructure/db/client";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { ledgerAttachments, ledgerCorrections, ledgerEntries, partnerBookings } from "@/infrastructure/db/schema";
import { notFound, rule } from "@/domain/errors";
import { DIRECTLY_REVERSIBLE, LEDGER_LABEL, entryAmount, rescaleDeltas, reversalDeltas, type Deltas } from "@/domain/ledger";
import type { PartnerKind } from "@/domain/partner";
import { editEntrySchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import { audit, bankBalance, cashBalance, claimBalance, insertEntry, insufficient, partnerBalance, walletBalance } from "../ledger-service";
import { assertBranch } from "../branches/assert-branch";
import { assertPartnerEntryReversible, partnerEntryDescription } from "../partners/partner-bookings";

type Entry = typeof ledgerEntries.$inferSelect;

async function loadReversible(tx: Tx, tenantId: string, entryId: string): Promise<Entry> {
  const orig = await tx.query.ledgerEntries.findFirst({
    where: and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.tenantId, tenantId)),
  });
  if (!orig) throw notFound("Buchung");
  if (!DIRECTLY_REVERSIBLE.includes(orig.type)) {
    throw rule(`${LEDGER_LABEL[orig.type]} kann hier nicht geändert werden (Rechnung stornieren bzw. Beleg ablehnen)`);
  }
  if (orig.closingId) throw rule("Buchung liegt in einem abgeschlossenen Monat");
  const already = await tx.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.reversalOfId, entryId) });
  if (already) throw rule("Buchung wurde bereits storniert");
  const corrected = await tx.query.ledgerCorrections.findFirst({ where: eq(ledgerCorrections.originalId, entryId) });
  if (corrected) throw rule("Buchung wurde bereits gelöscht bzw. geändert");
  await assertPartnerEntryReversible(tx, tenantId, entryId);
  return orig;
}

/** Kein Konto (Kasse, Bank, Budget, Auslagen, Kapital) darf durch die Netto-Wirkung negativ werden */
async function assertBalances(tx: Tx, tenantId: string, employeeId: string | null, net: Deltas) {
  const cash = await cashBalance(tx, tenantId);
  if (cash + net.cashDeltaCents < 0) throw insufficient("Kassenbestand", cash);
  const bank = await bankBalance(tx, tenantId);
  if (bank + net.bankDeltaCents < 0) throw insufficient("Bankkonto", bank);
  if (!employeeId) return;
  const w = await walletBalance(tx, tenantId, employeeId);
  if (w + net.walletDeltaCents < 0) throw insufficient("Budget / Guthaben", w);
  const c = await claimBalance(tx, tenantId, employeeId);
  if (c + net.claimDeltaCents < 0) throw insufficient("Auslagenkonto", c);
  const p = await partnerBalance(tx, tenantId, employeeId);
  if (p + net.partnerDeltaCents < 0) throw insufficient("Kapitalkonto", p);
}

const deltasOf = (e: Entry): Deltas => ({
  poolDeltaCents: e.poolDeltaCents, walletDeltaCents: e.walletDeltaCents, cashDeltaCents: e.cashDeltaCents,
  bankDeltaCents: e.bankDeltaCents, claimDeltaCents: e.claimDeltaCents, partnerDeltaCents: e.partnerDeltaCents,
  accountKind: e.accountKind,
});

const add = (a: Deltas, b: Deltas): Deltas => ({
  poolDeltaCents: a.poolDeltaCents + b.poolDeltaCents, walletDeltaCents: a.walletDeltaCents + b.walletDeltaCents,
  cashDeltaCents: a.cashDeltaCents + b.cashDeltaCents, bankDeltaCents: a.bankDeltaCents + b.bankDeltaCents,
  claimDeltaCents: a.claimDeltaCents + b.claimDeltaCents, partnerDeltaCents: a.partnerDeltaCents + b.partnerDeltaCents,
});

async function insertReversal(tx: Tx, ctx: Ctx, tenantId: string, orig: Entry, reason: string, bookingDate?: Date) {
  return insertEntry(tx, ctx, tenantId, {
    type: "REVERSAL", ...reversalDeltas(deltasOf(orig)), employeeId: orig.employeeId, reversalOfId: orig.id,
    category: orig.category, branchId: orig.branchId, bookingDate, description: `Storno: ${reason}`,
  });
}

async function balancesAfter(tx: Tx, tenantId: string, employeeId: string | null) {
  return {
    cashBalanceCents: await cashBalance(tx, tenantId),
    bankBalanceCents: await bankBalance(tx, tenantId),
    ...(employeeId && {
      walletBalanceCents: await walletBalance(tx, tenantId, employeeId),
      claimBalanceCents: await claimBalance(tx, tenantId, employeeId),
      capitalCents: await partnerBalance(tx, tenantId, employeeId),
    }),
  };
}

/** Stornieren: GoBD-konforme Gegenbuchung mit heutigem Datum */
export async function reverseLedgerEntry(ctx: Ctx, entryId: string, reason: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const orig = await loadReversible(tx, tenantId, entryId);
    await assertBalances(tx, tenantId, orig.employeeId, reversalDeltas(deltasOf(orig)));
    const entry = await insertReversal(tx, ctx, tenantId, orig, reason);
    await audit(tx, ctx, "ledger.reversal", "LedgerEntry", entry.id, { reversalOf: orig.id, reason });
    return { entry, ...(await balancesAfter(tx, tenantId, orig.employeeId)) };
  });
}

/** Löschen: Eintrag verschwindet aus allen Ansichten, Kontostand sofort neu berechnet */
export async function removeLedgerEntry(ctx: Ctx, entryId: string, reason: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const orig = await loadReversible(tx, tenantId, entryId);
    await assertBalances(tx, tenantId, orig.employeeId, reversalDeltas(deltasOf(orig)));
    const rev = await insertReversal(tx, ctx, tenantId, orig, `Gelöscht – ${reason}`, orig.bookingDate);
    const [c] = await tx.insert(ledgerCorrections).values({
      tenantId, kind: "REMOVE", originalId: orig.id, reversalId: rev.id,
      previousAmountCents: entryAmount(deltasOf(orig)), previousDescription: orig.description, reason, createdById: ctx.userId,
    }).returning();
    await audit(tx, ctx, "ledger.removed", "LedgerEntry", orig.id, {
      correctionId: c.id, reversalId: rev.id, type: orig.type, amountCents: c.previousAmountCents, description: orig.description, reason,
    });
    return { removedId: orig.id, ...(await balancesAfter(tx, tenantId, orig.employeeId)) };
  });
}

/** Ändern: Betrag, Verwendungszweck und/oder Filiale direkt anpassen (Storno + Ersatzbuchung am selben Tag) */
export async function editLedgerEntry(ctx: Ctx, entryId: string, input: z.infer<typeof editEntrySchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const orig = await loadReversible(tx, tenantId, entryId);
    if (orig.receiptId) throw rule("Beleg-Buchung: bitte über „Belege prüfen“ korrigieren");
    const booking = await tx.query.partnerBookings.findFirst({
      where: and(eq(partnerBookings.tenantId, tenantId), eq(partnerBookings.ledgerEntryId, orig.id)),
    });
    if (booking?.kind === "OUTLAY_REFUND") throw rule("Auslagen-Erstattung bitte stornieren und neu zuordnen");

    const oldD = deltasOf(orig);
    const oldAmount = entryAmount(oldD);
    const newAmount = input.amountCents ?? oldAmount;
    const newD = newAmount === oldAmount ? oldD : rescaleDeltas(oldD, newAmount);
    const branchId = input.branchId === undefined ? orig.branchId : await assertBranch(tx, tenantId, input.branchId);
    const purpose = input.description ?? booking?.purpose ?? orig.description ?? "";
    const description = booking
      ? partnerEntryDescription(booking.kind as PartnerKind, booking.source, orig.category, purpose)
      : input.description ?? orig.description;
    if (newAmount === oldAmount && description === orig.description && branchId === orig.branchId) {
      throw rule("Keine Änderung – Betrag, Verwendungszweck und Filiale sind gleich");
    }
    await assertBalances(tx, tenantId, orig.employeeId, add(newD, reversalDeltas(oldD)));

    const rev = await insertReversal(tx, ctx, tenantId, orig, `Geändert – ${input.reason}`, orig.bookingDate);
    const repl = await insertEntry(tx, ctx, tenantId, {
      type: orig.type, ...newD, employeeId: orig.employeeId, category: orig.category, batchId: orig.batchId,
      branchId, bookingDate: orig.bookingDate, description,
    });
    const att = await tx.query.ledgerAttachments.findFirst({ where: eq(ledgerAttachments.ledgerEntryId, orig.id) });
    if (att) {
      await tx.insert(ledgerAttachments).values({
        tenantId, ledgerEntryId: repl.id, fileKey: att.fileKey, mime: att.mime, name: att.name, createdById: ctx.userId,
      });
    }
    if (booking) {
      await tx.insert(partnerBookings).values({
        tenantId, partnerId: booking.partnerId, kind: booking.kind, source: booking.source, amountCents: newAmount,
        purpose: purpose.trim(), receiptKey: booking.receiptKey, receiptMime: booking.receiptMime, receiptName: booking.receiptName,
        bookingDate: booking.bookingDate, ledgerEntryId: repl.id, createdById: booking.createdById,
      });
    }
    const [c] = await tx.insert(ledgerCorrections).values({
      tenantId, kind: "EDIT", originalId: orig.id, reversalId: rev.id, replacementId: repl.id,
      previousAmountCents: oldAmount, previousDescription: orig.description, reason: input.reason, createdById: ctx.userId,
    }).returning();
    await audit(tx, ctx, "ledger.edited", "LedgerEntry", orig.id, {
      correctionId: c.id, replacementId: repl.id, reason: input.reason,
      before: { amountCents: oldAmount, description: orig.description, branchId: orig.branchId },
      after: { amountCents: newAmount, description, branchId },
    });
    return { entry: repl, previousAmountCents: oldAmount, ...(await balancesAfter(tx, tenantId, orig.employeeId)) };
  });
}
