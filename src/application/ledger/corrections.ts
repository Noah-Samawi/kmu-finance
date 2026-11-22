// Drei Aktionen je Buchung (Admin): Stornieren, Löschen, Ändern.
//  - Stornieren: GoBD-Gegenbuchung (heute), Original bleibt sichtbar als "storniert".
//  - Löschen:   Gegenbuchung am Buchungstag des Originals; Original + Storno verschwinden aus allen Ansichten,
//               Kontostände sind sofort korrigiert. Im Hauptbuch und Protokoll bleibt alles erhalten.
//  - Ändern:    wie Löschen, zusätzlich eine Ersatzbuchung (Betrag/Zweck/Filiale/Person/Gesellschafter-Art/MwSt.).
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/infrastructure/db/client";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { ledgerAttachments, ledgerCorrections, ledgerEntries, partnerBookings, users } from "@/infrastructure/db/schema";
import { expenseDeltas } from "@/domain/cash";
import { notFound, rule } from "@/domain/errors";
import { DIRECTLY_REVERSIBLE, LEDGER_LABEL, deltasFor, entryAmount, rescaleDeltas, reversalDeltas, type Deltas } from "@/domain/ledger";
import type { PartnerKind } from "@/domain/partner";
import { splitVat, vatLedgerSign } from "@/domain/vat-booking";
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
    vatRate: orig.vatRate, vatCents: -(orig.vatCents ?? 0), vatMode: orig.vatMode, partnerRole: orig.partnerRole,
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

async function loadAssignablePerson(tx: Tx, tenantId: string, personId: string) {
  const p = await tx.query.users.findFirst({
    where: and(eq(users.id, personId), eq(users.tenantId, tenantId), inArray(users.role, ["EMPLOYEE", "PARTNER"])),
  });
  if (!p) throw notFound("Person");
  return p;
}

/** Ändern: Betrag, Zweck, Filiale, Person, Gesellschafter-Art und/oder MwSt. (Storno + Ersatzbuchung am selben Tag) */
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

    let employeeId = orig.employeeId;
    if (input.personId !== undefined) {
      employeeId = input.personId ? (await loadAssignablePerson(tx, tenantId, input.personId)).id : null;
    }
    const person = employeeId ? await loadAssignablePerson(tx, tenantId, employeeId) : null;

    let partnerRole: "FIRMA" | "PRIVAT" | "GEWINN" | null = orig.partnerRole ?? null;
    if (input.partnerRole !== undefined) partnerRole = input.partnerRole;
    if (input.personId !== undefined && !input.personId) partnerRole = null;
    if (person?.role === "PARTNER") {
      if (!partnerRole) throw rule("Gesellschafter gewählt: bitte Firmenausgabe, Gewinnanteil oder Kapitalrückzahlung wählen");
    } else {
      partnerRole = null;
    }

    const account: "CASH" | "BANK" = orig.accountKind === "BANK" ? "BANK" : "CASH";
    const roleOf = (t: string, r: typeof partnerRole) =>
      t === "PARTNER_DRAW" || r === "PRIVAT" ? "PRIVAT" as const
        : t === "PARTNER_PROFIT" || r === "GEWINN" ? "GEWINN" as const
          : r === "FIRMA" ? "FIRMA" as const : null;
    const wasRole = roleOf(orig.type, orig.partnerRole ?? null);
    const nowRole = person?.role === "PARTNER" ? partnerRole : null;
    const canRetype = orig.type === "EXPENSE" || orig.type === "PARTNER_DRAW" || orig.type === "PARTNER_PROFIT";

    let type = orig.type;
    let newD: Deltas = newAmount === oldAmount ? { ...oldD } : rescaleDeltas(oldD, newAmount);
    let category = orig.category;

    if (canRetype && orig.walletDeltaCents === 0 && nowRole !== wasRole) {
      if (nowRole === "PRIVAT") {
        type = "PARTNER_DRAW";
        newD = deltasFor("PARTNER_DRAW", newAmount, account);
        category = null;
      } else if (nowRole === "GEWINN") {
        type = "PARTNER_PROFIT";
        newD = deltasFor("PARTNER_PROFIT", newAmount, account);
        category = null;
      } else if (nowRole === "FIRMA" || nowRole === null) {
        type = "EXPENSE";
        newD = expenseDeltas(account, newAmount);
        category = orig.category ?? "SONSTIGES";
      }
    } else if (canRetype && newAmount !== oldAmount && orig.walletDeltaCents === 0) {
      newD = type === "PARTNER_DRAW" ? deltasFor("PARTNER_DRAW", newAmount, account)
        : type === "PARTNER_PROFIT" ? deltasFor("PARTNER_PROFIT", newAmount, account)
          : rescaleDeltas(oldD, newAmount);
    } else if (canRetype && (nowRole === "PRIVAT" || nowRole === "GEWINN") && orig.walletDeltaCents !== 0) {
      throw rule("Kapitalrückzahlung/Gewinnanteil nicht aus Budget – bitte Kasse oder Bank wählen bzw. neu buchen");
    }

    const branchId = input.branchId === undefined ? orig.branchId : await assertBranch(tx, tenantId, input.branchId);
    const purpose = input.description ?? booking?.purpose ?? orig.description ?? "";
    const description = booking
      ? partnerEntryDescription(booking.kind as PartnerKind, booking.source, category, purpose)
      : input.description ?? orig.description;

    let vatRate = orig.vatRate;
    let vatCents = orig.vatCents ?? 0;
    let vatMode = orig.vatMode;
    if (nowRole === "PRIVAT" || nowRole === "GEWINN") {
      vatRate = null; vatCents = 0; vatMode = null;
    } else if (input.vatRate !== undefined) {
      const mode = input.vatMode ?? (orig.vatMode === "NET" ? "NET" : "GROSS");
      const split = splitVat(newAmount, input.vatRate, "GROSS");
      vatRate = split.vatRate || null;
      vatCents = vatRate
        ? vatLedgerSign(type === "INCOME_MANUAL" || type === "INCOME_INVOICE" ? "INCOME" : "EXPENSE", split.vatCents)
        : 0;
      vatMode = vatRate ? mode : null;
    }

    const unchanged =
      newAmount === oldAmount
      && description === orig.description
      && branchId === orig.branchId
      && employeeId === orig.employeeId
      && partnerRole === (orig.partnerRole ?? null)
      && type === orig.type
      && (vatRate ?? null) === (orig.vatRate ?? null)
      && vatCents === (orig.vatCents ?? 0);
    if (unchanged) throw rule("Keine Änderung – Werte sind gleich");

    // Netto-Wirkung auf Kasse/Bank; Personenkonten je betroffenem Konto prüfen
    const net = add(newD, reversalDeltas(oldD));
    if (orig.employeeId && employeeId && orig.employeeId === employeeId) {
      await assertBalances(tx, tenantId, employeeId, net);
    } else {
      await assertBalances(tx, tenantId, null, net);
      if (orig.employeeId) await assertBalances(tx, tenantId, orig.employeeId, reversalDeltas(oldD));
      if (employeeId) await assertBalances(tx, tenantId, employeeId, newD);
    }

    const rev = await insertReversal(tx, ctx, tenantId, orig, `Geändert – ${input.reason}`, orig.bookingDate);
    const repl = await insertEntry(tx, ctx, tenantId, {
      type, ...newD, employeeId, category, batchId: orig.batchId,
      branchId, bookingDate: orig.bookingDate, description,
      vatRate, vatCents, vatMode, partnerRole,
    });
    const att = await tx.query.ledgerAttachments.findFirst({ where: eq(ledgerAttachments.ledgerEntryId, orig.id) });
    if (att) {
      await tx.insert(ledgerAttachments).values({
        tenantId, ledgerEntryId: repl.id, fileKey: att.fileKey, mime: att.mime, name: att.name, createdById: ctx.userId,
      });
    }
    if (booking) {
      await tx.insert(partnerBookings).values({
        tenantId, companyId: booking.companyId ?? repl.companyId, partnerId: booking.partnerId, kind: booking.kind, source: booking.source, amountCents: newAmount,
        purpose: purpose.trim(), receiptKey: booking.receiptKey, receiptMime: booking.receiptMime, receiptName: booking.receiptName,
        bookingDate: booking.bookingDate, ledgerEntryId: repl.id, createdById: booking.createdById,
      });
    }
    const [c] = await tx.insert(ledgerCorrections).values({
      tenantId, companyId: repl.companyId, kind: "EDIT", originalId: orig.id, reversalId: rev.id, replacementId: repl.id,
      previousAmountCents: oldAmount, previousDescription: orig.description, reason: input.reason, createdById: ctx.userId,
    }).returning();
    await audit(tx, ctx, "ledger.edited", "LedgerEntry", orig.id, {
      correctionId: c.id, replacementId: repl.id, reason: input.reason,
      before: {
        amountCents: oldAmount, description: orig.description, branchId: orig.branchId,
        personId: orig.employeeId, partnerRole: orig.partnerRole, type: orig.type,
      },
      after: { amountCents: newAmount, description, branchId, personId: employeeId, partnerRole, type },
    });
    return {
      entry: repl, previousAmountCents: oldAmount,
      ...(await balancesAfter(tx, tenantId, employeeId ?? orig.employeeId)),
    };
  });
}
