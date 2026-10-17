// Kasse & Bank (Gastro): Tageseinnahme Kasse + Bank, Betriebsausgaben mit Kategorie, Bestandskorrektur zum Stichtag.
import { ACCOUNT_LABEL, type AccountKind } from "./accounts";
import { rule } from "./errors";
import type { Deltas } from "./ledger";
import { formatCents } from "./money";
import { fmtDate } from "./period";

export const EXPENSE_CATEGORIES = {
  WAREN: "Wareneinkauf (Lebensmittel)",
  GETRAENKE: "Getränke",
  VERPACKUNG: "Verpackung & Einweg",
  REINIGUNG: "Reinigung & Hygiene",
  ENERGIE: "Energie (Strom, Gas, Wasser)",
  MIETE: "Miete & Nebenkosten",
  REPARATUR: "Reparatur & Instandhaltung",
  AUSSTATTUNG: "Küchen- & Betriebsausstattung",
  GEBUEHREN: "Gebühren & Versicherungen",
  MARKETING: "Werbung & Marketing",
  SONSTIGES: "Sonstige Betriebskosten",
} as const;
export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;
export const EXPENSE_CATEGORY_KEYS = Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[];

export const categoryLabel = (c: string | null | undefined) =>
  c && c in EXPENSE_CATEGORIES ? EXPENSE_CATEGORIES[c as ExpenseCategory] : "Ohne Kategorie";

/** Woraus wird eine Ausgabe bezahlt? */
export type ExpenseFund = "CASH" | "BANK" | "BUDGET" | "CAPITAL";
export const FUND_LABEL: Record<ExpenseFund, string> = {
  CASH: ACCOUNT_LABEL.CASH,
  BANK: ACCOUNT_LABEL.BANK,
  BUDGET: "Budget / Vorschuss der Person",
  CAPITAL: "Kapitalkonto des Gesellschafters",
};

const none = { poolDeltaCents: 0, walletDeltaCents: 0, cashDeltaCents: 0, bankDeltaCents: 0, claimDeltaCents: 0, partnerDeltaCents: 0 };

/**
 * Hauptbuch-Wirkung einer Betriebsausgabe (immer Typ EXPENSE = Aufwand der Firma).
 *   Kasse / Bank  -> Firmenkonto −
 *   Budget        -> Guthaben der Person − (sie hat mit Firmengeld bezahlt)
 *   Kapital       -> Kapitalkonto des Gesellschafters − (z. B. 6.000 € − 2.000 € Metro = 4.000 €)
 */
export function expenseDeltas(fund: ExpenseFund, amountCents: number): Deltas {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw rule("Betrag muss größer als 0 sein");
  const a = amountCents;
  switch (fund) {
    case "CASH":
      return { ...none, poolDeltaCents: -a, cashDeltaCents: -a, accountKind: "CASH" };
    case "BANK":
      return { ...none, poolDeltaCents: -a, bankDeltaCents: -a, accountKind: "BANK" };
    case "BUDGET":
      return { ...none, walletDeltaCents: -a, accountKind: null };
    case "CAPITAL":
      return { ...none, partnerDeltaCents: -a, accountKind: null };
  }
}

export function assertCategory(c: string | null | undefined): ExpenseCategory {
  if (!c || !(c in EXPENSE_CATEGORIES)) throw rule("Bitte Kategorie auswählen");
  return c as ExpenseCategory;
}

/** Tageseinnahme: Kasse und/oder Bank – mindestens ein Betrag > 0 */
export function dailyIncomeParts(cashCents?: number | null, bankCents?: number | null): { account: AccountKind; amountCents: number }[] {
  const parts: { account: AccountKind; amountCents: number }[] = [];
  for (const [account, v] of [["CASH", cashCents], ["BANK", bankCents]] as const) {
    if (v === undefined || v === null || v === 0) continue;
    if (!Number.isInteger(v) || v < 0) throw rule("Beträge müssen positiv sein");
    parts.push({ account, amountCents: v });
  }
  if (!parts.length) throw rule("Bitte Betrag für Kasse (Bar) und/oder Bankkonto eingeben");
  return parts;
}

export function duplicateWarning(count: number): string | null {
  return count > 0 ? "Achtung: Für dieses Datum existiert bereits eine Einnahmebuchung!" : null;
}

/** Differenzkorrektur: Ist-Bestand − Buchbestand zum Stichtag (0 = keine Korrektur nötig) */
export function correctionDiff(bookCents: number, actualCents: number): number {
  if (!Number.isInteger(actualCents) || actualCents < 0) throw rule("Ist-Bestand muss 0 oder größer sein");
  const diff = actualCents - bookCents;
  if (diff === 0) throw rule("Ist-Bestand entspricht dem Buchbestand – keine Korrektur nötig");
  return diff;
}

export function correctionText(account: AccountKind, date: Date, bookCents: number, actualCents: number, reason: string) {
  const diff = actualCents - bookCents;
  return `Bestandskorrektur ${ACCOUNT_LABEL[account]} zum ${fmtDate(date)} · Buchbestand ${formatCents(bookCents)} → Ist ${formatCents(actualCents)} (Differenz ${diff > 0 ? "+" : ""}${formatCents(diff)}) · ${reason.trim()}`;
}
