// Partner-Übersicht: Salden-Spalten und Buchungs-Art für Filter/Gruppierung.
// Kapital ≠ Gewinnanteil ≠ Betriebsausgabe ≠ Lohn ≠ Auslage ≠ Budget.
import type { PartnerKind, FundingSource } from "./partner";
import type { LedgerType } from "./ledger";

/** Filter-/Gruppen-Art in der Partner-Buchungsliste */
export type PartnerArt =
  | "KAPITAL"
  | "RUECKZAHLUNG"
  | "GEWINN"
  | "FIRMA"
  | "LOHN"
  | "AUSLAGE"
  | "BUDGET"
  | "SONST";

export const PARTNER_ART_LABEL: Record<PartnerArt, string> = {
  KAPITAL: "Kapital / Einlage",
  RUECKZAHLUNG: "Kapitalrückzahlung",
  GEWINN: "Gewinnanteil",
  FIRMA: "Betriebsausgabe",
  LOHN: "Lohn",
  AUSLAGE: "Auslage",
  BUDGET: "Budget / Vorschuss",
  SONST: "Sonstiges",
};

export const PARTNER_ARTS: PartnerArt[] = [
  "KAPITAL", "RUECKZAHLUNG", "GEWINN", "FIRMA", "LOHN", "AUSLAGE", "BUDGET", "SONST",
];

export function artFromPartnerKind(kind: PartnerKind, source: FundingSource | null): PartnerArt {
  switch (kind) {
    case "DEPOSIT": return "KAPITAL";
    case "DRAW": return "RUECKZAHLUNG";
    case "PROFIT": return "GEWINN";
    case "OUTLAY": return source === "PRIVATE" ? "AUSLAGE" : "FIRMA";
    case "OUTLAY_REFUND": return "AUSLAGE";
    case "PURCHASE_CAPITAL": return "KAPITAL";
    case "PURCHASE_BUDGET":
    case "BUDGET":
    case "BUDGET_RETURN":
    case "BUDGET_SETTLED":
      return "BUDGET";
    default: return "SONST";
  }
}

export function artFromLedger(
  type: LedgerType,
  partnerRole: "FIRMA" | "PRIVAT" | "GEWINN" | "LOHN" | null,
): PartnerArt {
  if (partnerRole === "LOHN") return "LOHN";
  if (type === "PARTNER_PROFIT" || partnerRole === "GEWINN") return "GEWINN";
  if (type === "PARTNER_DRAW" || partnerRole === "PRIVAT") return "RUECKZAHLUNG";
  if (type === "PARTNER_DEPOSIT") return "KAPITAL";
  if (type === "PARTNER_OUTLAY" || type === "PARTNER_OUTLAY_REFUND" || type === "EMPLOYEE_OUTLAY" || type === "OUTLAY_REPAY") {
    return "AUSLAGE";
  }
  if (type === "ALLOCATION" || type === "RETURN") return "BUDGET";
  if (type === "EXPENSE" || type === "PARTNER_EXPENSE" || partnerRole === "FIRMA") return "FIRMA";
  return "SONST";
}

/** Kopf-Salden für Partner-Karte (Beträge als absolute Summen der jeweiligen Art) */
export interface PartnerOverviewFigures {
  /** Rest Kapitalkonto (partnerDelta) */
  capitalCents: number;
  /** Summe Kapitalrückzahlungen / Entnahmen (positiv = ausgezahlt) */
  capitalReturnCents: number;
  /** Summe Gewinnanteil-Auszahlungen */
  profitCents: number;
  /** Summe zugeordnete Betriebsausgaben */
  companyExpenseCents: number;
  /** Summe Lohn */
  wageCents: number;
  outlayOpenCents: number;
  budgetCents: number;
}

export type LedgerSumRow = {
  type: LedgerType;
  reversedType?: LedgerType | null;
  partnerRole?: "FIRMA" | "PRIVAT" | "GEWINN" | "LOHN" | null;
  partnerDeltaCents: number;
  cashDeltaCents: number;
  bankDeltaCents: number;
  claimDeltaCents: number;
  walletDeltaCents: number;
};

function eff(r: LedgerSumRow): LedgerType {
  return r.type === "REVERSAL" ? (r.reversedType ?? "REVERSAL") : r.type;
}

/** Betrag der Zahlung (Kasse/Bank), positiv */
function paidOut(r: LedgerSumRow): number {
  const d = r.cashDeltaCents + r.bankDeltaCents;
  return d < 0 ? -d : 0;
}

/**
 * Summen aus Hauptbuchzeilen einer Person.
 * capital/outlay/budget = laufende Konten; Rest = kumulierte Auszahlungen/Zuordnungen.
 */
export function partnerOverviewFromLedger(
  rows: LedgerSumRow[],
  balances: { capitalCents: number; outlayOpenCents: number; budgetCents: number },
): PartnerOverviewFigures {
  let capitalReturnCents = 0;
  let profitCents = 0;
  let companyExpenseCents = 0;
  let wageCents = 0;
  for (const r of rows) {
    const t = eff(r);
    const art = artFromLedger(t, r.partnerRole ?? null);
    const paid = paidOut(r);
    if (art === "RUECKZAHLUNG") capitalReturnCents += paid || Math.abs(r.partnerDeltaCents);
    else if (art === "GEWINN") profitCents += paid || Math.abs(r.cashDeltaCents + r.bankDeltaCents);
    else if (art === "LOHN") wageCents += paid;
    else if (art === "FIRMA") companyExpenseCents += paid;
  }
  return {
    capitalCents: balances.capitalCents,
    capitalReturnCents,
    profitCents,
    companyExpenseCents,
    wageCents,
    outlayOpenCents: balances.outlayOpenCents,
    budgetCents: balances.budgetCents,
  };
}
