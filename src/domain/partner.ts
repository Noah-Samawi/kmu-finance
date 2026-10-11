// Gesellschafter-Buchungen: Mittelherkunft, Verrechnungskonto "Vorgelegtes Geld", gezielte Erstattung.
//
// Drei strikt getrennte Konten je Gesellschafter (alle über LedgerEntry.employeeId):
//   Kapitalkonto            partnerDeltaCents  (Einlagen, Entnahmen, Gewinnanteile)
//   Vorgelegtes Geld        claimDeltaCents    (Auslagen aus eigener Tasche, nur durch Erstattung reduziert)
//   Budget / Vorschuss      walletDeltaCents   (Geld, das die Firma dem Gesellschafter vorstreckt)
// Kein Vorgang bucht automatisch zwischen diesen Konten um.
import type { AccountKind } from "./accounts";
import type { Deltas, LedgerType } from "./ledger";
import { rule } from "./errors";

export type FundingSource = "PRIVATE" | "BANK" | "CASH";
export const FUNDING_SOURCES: FundingSource[] = ["PRIVATE", "BANK", "CASH"];

export type PartnerKind =
  | "DEPOSIT" | "OUTLAY" | "DRAW" | "PROFIT"
  | "BUDGET" | "BUDGET_RETURN" | "BUDGET_SETTLED"
  | "OUTLAY_REFUND";

/** Vorgänge, die ein Gesellschafter selbst erfassen darf */
export const SELF_KINDS = ["DEPOSIT", "OUTLAY", "DRAW"] as const;
/** Vorgänge über das allgemeine Admin-Buchungsformular (Erstattung hat einen eigenen Ablauf) */
export const ADMIN_KINDS = ["DEPOSIT", "OUTLAY", "DRAW", "PROFIT", "BUDGET", "BUDGET_RETURN", "BUDGET_SETTLED"] as const;

export const FUNDING_LABEL: Record<FundingSource, string> = {
  PRIVATE: "Eigene Tasche / Privat",
  BANK: "Bankkonto der Firma",
  CASH: "Kassensystem / Bar",
};

export const PARTNER_KIND_LABEL: Record<PartnerKind, string> = {
  DEPOSIT: "Einlage",
  OUTLAY: "Auslage / Ausgabe für die Firma",
  DRAW: "Entnahme",
  PROFIT: "Gewinnanteil (ohne Auszahlung)",
  BUDGET: "Budget-Zuteilung (Vorschuss)",
  BUDGET_RETURN: "Budget-Rückgabe",
  BUDGET_SETTLED: "Budget verbraucht (abgerechnet)",
  OUTLAY_REFUND: "Auslagen-Erstattung",
};

/** Ohne Beleg muss die Begründung aussagekräftig sein */
export const REASON_MIN_WITHOUT_RECEIPT = 10;

export function assertPurpose(purpose: string, hasReceipt: boolean) {
  const p = purpose.trim();
  if (!hasReceipt && p.length < REASON_MIN_WITHOUT_RECEIPT) {
    throw rule(`Ohne Beleg ist „Wofür? / Begründung“ Pflicht (mindestens ${REASON_MIN_WITHOUT_RECEIPT} Zeichen)`);
  }
  if (p.length < 3) throw rule("„Wofür? / Begründung“ fehlt");
}

/** Welche Mittelherkunft ist für den Vorgang zulässig? null = Vorgang ohne Geldfluss */
export function allowedSources(kind: PartnerKind): FundingSource[] | null {
  switch (kind) {
    case "DEPOSIT":
    case "OUTLAY":
      return ["PRIVATE", "BANK", "CASH"];
    case "DRAW":
    case "BUDGET":
    case "BUDGET_RETURN":
    case "OUTLAY_REFUND":
      return ["BANK", "CASH"];
    case "PROFIT":
    case "BUDGET_SETTLED":
      return null;
  }
}

export function assertSource(kind: PartnerKind, source: FundingSource | null | undefined): FundingSource | null {
  const allowed = allowedSources(kind);
  if (allowed === null) return null;
  if (!source) throw rule("Bitte Mittelherkunft / Konto auswählen");
  if (!allowed.includes(source)) {
    throw rule(`${PARTNER_KIND_LABEL[kind]}: „${FUNDING_LABEL[source]}“ ist hier nicht möglich`);
  }
  return source;
}

const none = { poolDeltaCents: 0, walletDeltaCents: 0, cashDeltaCents: 0, bankDeltaCents: 0, claimDeltaCents: 0, partnerDeltaCents: 0 };

function account(amount: number, source: FundingSource): Pick<Deltas, "poolDeltaCents" | "cashDeltaCents" | "bankDeltaCents" | "accountKind"> {
  const acc: AccountKind = source === "BANK" ? "BANK" : "CASH";
  return {
    poolDeltaCents: amount,
    cashDeltaCents: acc === "CASH" ? amount : 0,
    bankDeltaCents: acc === "BANK" ? amount : 0,
    accountKind: acc,
  };
}

/**
 * Hauptbuch-Wirkung eines Gesellschafter-Vorgangs. amountCents ist immer positiv.
 *  - Auslage aus eigener Tasche  -> nur "Vorgelegtes Geld" +  (Firma schuldet dem Gesellschafter)
 *  - Ausgabe mit Firmenkarte/Kasse -> Bank/Kasse −, KEIN Erstattungsanspruch
 *  - Einlage privat bezahlt       -> nur Kapitalkonto + (z. B. Firmenrechnung privat beglichen)
 *  - Erstattung                   -> Bank/Kasse −, "Vorgelegtes Geld" −
 */
export function partnerPosting(kind: PartnerKind, source: FundingSource | null, amountCents: number): { type: LedgerType; deltas: Deltas } {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw rule("Betrag muss größer als 0 sein");
  const src = assertSource(kind, source);
  const a = amountCents;
  switch (kind) {
    case "DEPOSIT":
      return src === "PRIVATE"
        ? { type: "PARTNER_DEPOSIT", deltas: { ...none, partnerDeltaCents: a, accountKind: null } }
        : { type: "PARTNER_DEPOSIT", deltas: { ...none, ...account(a, src!), partnerDeltaCents: a } };
    case "OUTLAY":
      return src === "PRIVATE"
        ? { type: "PARTNER_OUTLAY", deltas: { ...none, claimDeltaCents: a, accountKind: null } }
        : { type: "PARTNER_EXPENSE", deltas: { ...none, ...account(-a, src!) } };
    case "DRAW":
      return { type: "PARTNER_DRAW", deltas: { ...none, ...account(-a, src!), partnerDeltaCents: -a } };
    case "PROFIT":
      return { type: "PARTNER_PROFIT", deltas: { ...none, partnerDeltaCents: a, accountKind: null } };
    case "BUDGET":
      return { type: "ALLOCATION", deltas: { ...none, ...account(-a, src!), walletDeltaCents: a } };
    case "BUDGET_RETURN":
      return { type: "RETURN", deltas: { ...none, ...account(a, src!), walletDeltaCents: -a } };
    case "BUDGET_SETTLED":
      return { type: "ADJUSTMENT", deltas: { ...none, walletDeltaCents: -a, accountKind: null } };
    case "OUTLAY_REFUND":
      return { type: "PARTNER_OUTLAY_REFUND", deltas: { ...none, ...account(-a, src!), claimDeltaCents: -a } };
  }
}

/** Nur Auslagen aus eigener Tasche sind erstattungsfähig */
export const isRefundable = (kind: PartnerKind, source: FundingSource | null) => kind === "OUTLAY" && source === "PRIVATE";

export type RefundStatus = "OPEN" | "PARTIAL" | "REFUNDED";

export function refundStatus(amountCents: number, refundedCents: number): RefundStatus {
  if (refundedCents <= 0) return "OPEN";
  return refundedCents >= amountCents ? "REFUNDED" : "PARTIAL";
}

export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  OPEN: "offen",
  PARTIAL: "teilweise erstattet",
  REFUNDED: "erstattet",
};

/**
 * Prüft eine Erstattung gegen die offenen Auslagen. Jede Position muss
 * explizit einer offenen Auslage zugeordnet sein und darf deren Restbetrag
 * nicht überschreiten. Rückgabe: Gesamtbetrag der Erstattung.
 */
export function validateRefundAllocation(
  open: { id: string; openCents: number }[],
  items: { outlayId: string; amountCents: number }[],
): number {
  if (!items.length) throw rule("Bitte mindestens eine offene Auslage auswählen");
  const byId = new Map(open.map((o) => [o.id, o.openCents]));
  const seen = new Set<string>();
  let total = 0;
  for (const it of items) {
    if (seen.has(it.outlayId)) throw rule("Eine Auslage wurde doppelt ausgewählt");
    seen.add(it.outlayId);
    const rest = byId.get(it.outlayId);
    if (rest === undefined) throw rule("Auslage ist nicht (mehr) offen oder gehört nicht zu diesem Gesellschafter");
    if (!Number.isInteger(it.amountCents) || it.amountCents <= 0) throw rule("Erstattungsbetrag muss größer als 0 sein");
    if (it.amountCents > rest) throw rule("Erstattung übersteigt den offenen Betrag der Auslage");
    total += it.amountCents;
  }
  return total;
}
