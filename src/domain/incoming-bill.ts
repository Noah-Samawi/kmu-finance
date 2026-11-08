// Eingangsrechnung / Lieferantenbeleg: Herkunftskonto ist immer sichtbar,
// Status (offen / bezahlt / Guthaben) wird aus Betrag und gezahltem Betrag abgeleitet.
import { ACCOUNT_LABEL, type AccountKind } from "./accounts";
import { formatCents } from "./money";
import { fmtDate } from "./period";
import { rule } from "./errors";

export type BillPayKind = "CASH" | "BANK" | "UNPAID";
export type BillStatus = "OPEN" | "PAID" | "CREDIT";

export const PAY_KIND_LABEL: Record<BillPayKind, string> = {
  CASH: "Bar (Kasse)",
  BANK: "Karte / Überweisung (Bankkonto)",
  UNPAID: "Noch nicht bezahlt",
};

/** Wohin die Ausgabe gebucht wurde – nie „heimlich“, immer dieser Klartext. */
export function bookedWhereLabel(fund: AccountKind | null | undefined, paidCents: number): string {
  if (!paidCents || !fund) return "Noch nicht gebucht";
  return fund === "CASH" ? "Ausgabe Kasse (Bar)" : "Ausgabe Bankkonto";
}

export function billDue(amountCents: number, paidCents: number): { status: BillStatus; dueCents: number; creditCents: number } {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw rule("Rechnungsbetrag muss größer als 0 sein");
  if (!Number.isInteger(paidCents) || paidCents < 0) throw rule("Gezahlter Betrag darf nicht negativ sein");
  if (paidCents > amountCents) return { status: "CREDIT", dueCents: 0, creditCents: paidCents - amountCents };
  if (paidCents === amountCents) return { status: "PAID", dueCents: 0, creditCents: 0 };
  return { status: "OPEN", dueCents: amountCents - paidCents, creditCents: 0 };
}

export function billStatusLabel(amountCents: number, paidCents: number): string {
  const { status, dueCents, creditCents } = billDue(amountCents, paidCents);
  if (status === "PAID") return "Komplett bezahlt";
  if (status === "CREDIT") return `Guthaben vorhanden · ${formatCents(creditCents)}`;
  if (paidCents > 0) return `Teilbezahlt – noch ${formatCents(dueCents)} fällig`;
  return `Noch offen / ${formatCents(dueCents)} fällig`;
}

export function resolvePaidCents(payKind: BillPayKind, amountCents: number, paidCents: number | null | undefined): number {
  if (payKind === "UNPAID") {
    if (paidCents && paidCents > 0) throw rule("Bei „Noch nicht bezahlt“ darf kein gezahlter Betrag stehen – bitte Bar oder Bank wählen");
    return 0;
  }
  const paid = paidCents == null ? amountCents : paidCents;
  if (paid <= 0) throw rule("Bitte den gezahlten Betrag eingeben oder „Noch nicht bezahlt“ wählen");
  return paid;
}

export function fundFromPayKind(payKind: BillPayKind): AccountKind | null {
  return payKind === "UNPAID" ? null : payKind;
}

/**
 * Dublette nur auf DEMSELBEN Konto: gleiche Datei ist hart blockiert (API),
 * gleicher Lieferant + Betrag + Tag auf Kasse und Bank gleichzeitig ist erlaubt.
 */
export function billDuplicateWarning(
  fund: AccountKind, date: Date, existingOnFund: number, supplier: string,
): string | null {
  if (existingOnFund <= 0) return null;
  return `Achtung: ${supplier} über ${fmtDate(date)} ist auf ${ACCOUNT_LABEL[fund]} bereits mit gleichem Betrag erfasst.`;
}

export interface IncomingBillView {
  status: BillStatus;
  dueCents: number;
  creditCents: number;
  statusLabel: string;
  bookedLabel: string;
  bookedWhere: AccountKind | null;
}

export function presentBill(
  amountCents: number,
  paidCents: number,
  fund: AccountKind | null | undefined,
  flags?: { reversed?: boolean; removed?: boolean },
): IncomingBillView {
  const { status, dueCents, creditCents } = billDue(amountCents, paidCents);
  let bookedLabel = bookedWhereLabel(fund ?? null, paidCents);
  if (flags?.removed) bookedLabel = "Buchung gelöscht";
  else if (flags?.reversed && paidCents > 0) bookedLabel = `${bookedLabel} · storniert`;
  return {
    status, dueCents, creditCents,
    statusLabel: billStatusLabel(amountCents, paidCents),
    bookedLabel,
    bookedWhere: paidCents > 0 && fund ? fund : null,
  };
}
