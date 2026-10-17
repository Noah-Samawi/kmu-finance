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

const INCOME_NOUN: Record<AccountKind, string> = { CASH: "Kassen-Einnahmen", BANK: "Bank-Einnahmen" };

/**
 * Dubletten-Hinweis je Konto: nur wenn auf DASSELBE Konto erneut gebucht wird.
 * 1× Kasse + 1× Bank am selben Tag ist der Normalfall und löst nie eine Warnung aus.
 */
export function duplicateWarning(account: AccountKind, date: Date, existingOnAccount: number): string | null {
  return existingOnAccount > 0 ? `Achtung: Für das Datum ${fmtDate(date)} wurden bereits ${INCOME_NOUN[account]} erfasst!` : null;
}

export function duplicateWarnings(
  date: Date, existing: Record<AccountKind, number>, booking: { cash: boolean; bank: boolean },
): string[] {
  return [
    booking.cash ? duplicateWarning("CASH", date, existing.CASH) : null,
    booking.bank ? duplicateWarning("BANK", date, existing.BANK) : null,
  ].filter((w): w is string => !!w);
}

/** Klartext einer Buchung mit Konto – Kasse und Bank werden nie zusammengefasst */
export function entryLabel(
  type: string, base: string,
  r: { accountKind?: AccountKind | null; walletDeltaCents?: number; partnerDeltaCents?: number },
): string {
  if (type === "INCOME_MANUAL" && r.accountKind) return `Tageseinnahme ${ACCOUNT_LABEL[r.accountKind]}`;
  if (type === "INCOME_INVOICE" && r.accountKind) return `Rechnungseingang ${ACCOUNT_LABEL[r.accountKind]}`;
  if (type === "EXPENSE") {
    if (r.accountKind) return `Ausgabe ${ACCOUNT_LABEL[r.accountKind]}`;
    if (r.walletDeltaCents) return "Einkauf aus Budget / Vorschuss";
    if (r.partnerDeltaCents) return "Einkauf vom Kapitalkonto";
  }
  return base;
}

/** Bewegungen EINES Firmenkontos (Kasse oder Bank) – getrennt nach Vorgang, ohne Vermischung */
export interface AccountFlow {
  openingCents: number;
  /** Tageseinnahmen (manuell) */
  dailyIncomeCents: number;
  /** Zahlungseingänge aus Rechnungen */
  invoiceIncomeCents: number;
  /** Ausgaben dieses Kontos (Betriebsausgaben + Gesellschafter mit Firmenmitteln), positiv */
  expenseCents: number;
  /** Budget an Personen, positiv */
  allocatedCents: number;
  /** Rückgaben von Personen */
  returnedCents: number;
  /** Umbuchung Bank ↔ Kasse (Bargeldabhebung), ± */
  transferCents: number;
  /** Bestandskorrekturen, ± */
  correctionCents: number;
  /** Gesellschafter-Einlagen/-Entnahmen, Erstattungen, ± */
  otherCents: number;
  closingCents: number;
}

export interface FlowRow { type: string; cashDeltaCents: number; bankDeltaCents: number }

export function accountFlow(account: AccountKind, openingCents: number, rows: FlowRow[]): AccountFlow {
  const f: AccountFlow = {
    openingCents, dailyIncomeCents: 0, invoiceIncomeCents: 0, expenseCents: 0, allocatedCents: 0,
    returnedCents: 0, transferCents: 0, correctionCents: 0, otherCents: 0, closingCents: openingCents,
  };
  for (const r of rows) {
    const d = account === "CASH" ? r.cashDeltaCents : r.bankDeltaCents;
    if (!d) continue;
    switch (r.type) {
      case "INCOME_MANUAL": f.dailyIncomeCents += d; break;
      case "INCOME_INVOICE": f.invoiceIncomeCents += d; break;
      case "EXPENSE": case "PARTNER_EXPENSE": f.expenseCents -= d; break;
      case "ALLOCATION": f.allocatedCents -= d; break;
      case "RETURN": f.returnedCents += d; break;
      case "CASH_WITHDRAWAL": f.transferCents += d; break;
      case "ACCOUNT_ADJUST": f.correctionCents += d; break;
      default: f.otherCents += d;
    }
    f.closingCents += d;
  }
  for (const k of Object.keys(f) as (keyof AccountFlow)[]) f[k] += 0;
  return f;
}

export interface FlowLine { label: string; cents: number; strong?: boolean }

/** Darstellung eines Kontos: Einnahmen erhöhen, Ausgaben mindern – nur Bewegungen dieses Kontos */
export function accountFlowLines(account: AccountKind, f: AccountFlow): FlowLine[] {
  const name = ACCOUNT_LABEL[account];
  const optional = (label: string, cents: number) => (cents ? [{ label, cents }] : []);
  return [
    { label: "Anfangsbestand (Übertrag)", cents: f.openingCents },
    { label: `+ Tageseinnahmen ${name}`, cents: f.dailyIncomeCents },
    { label: "+ Zahlungseingänge aus Rechnungen", cents: f.invoiceIncomeCents },
    { label: `− Ausgaben ${name}`, cents: f.expenseCents },
    { label: "− Budget an Personen", cents: f.allocatedCents },
    { label: "+ Rückgaben von Personen", cents: f.returnedCents },
    ...optional(account === "CASH" ? "± Umbuchung vom Bankkonto (Abhebung)" : "± Umbuchung in die Kasse (Abhebung)", f.transferCents),
    ...optional("± Bestandskorrekturen", f.correctionCents),
    ...optional("± Gesellschafter & Erstattungen", f.otherCents),
    { label: `= Endbestand ${name}`, cents: f.closingCents, strong: true },
  ];
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
