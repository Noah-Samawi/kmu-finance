// Filial-Auswertung: Umsätze (Kasse/Bank getrennt) und Kosten je Standort.
// Bestände je Filiale werden aus dem Hauptbuch abgeleitet (SUM der Deltas WHERE branchId),
// nicht als gespeicherter Anfangsbestand. null = zentrale Verwaltungskosten.
// Die Auszahlungsprüfung (kein Minus auf dem realen Firmenkonto) bleibt unternehmensweit.
import { accountFlow, categoryLabel, flowType, type AccountFlow } from "./cash";
import type { LedgerType } from "./ledger";
import { formatCents } from "./money";
import { fmtDate } from "./period";

/** URL-/Filterwert für Buchungen ohne Filiale */
export const UNASSIGNED_BRANCH = "none";
export const UNASSIGNED_BRANCH_NAME = "Ohne Filiale (zentral)";

export interface BranchRow {
  type: LedgerType; reversedType?: LedgerType | null;
  cashDeltaCents: number; bankDeltaCents: number; poolDeltaCents: number;
  walletDeltaCents: number; partnerDeltaCents: number;
  category: string | null;
}

export interface BranchFigures {
  /** Umsatz Kasse (Bar): Tageseinnahmen + Rechnungseingänge bar */
  revenueCashCents: number;
  /** Umsatz Bankkonto: Tageseinnahmen + Rechnungseingänge per Bank */
  revenueBankCents: number;
  revenueCents: number;
  costsCashCents: number;
  costsBankCents: number;
  /** aus Budgets von Personen, Kapitalkonten oder per Beleg */
  costsOtherCents: number;
  costsCents: number;
  costsByCategory: { category: string; label: string; cents: number }[];
  resultCents: number;
}

const eff = (r: BranchRow): LedgerType => (r.type === "REVERSAL" ? r.reversedType ?? "REVERSAL" : r.type);

export function branchFigures(rows: BranchRow[]): BranchFigures {
  const f = { revenueCashCents: 0, revenueBankCents: 0, costsCashCents: 0, costsBankCents: 0, costsOtherCents: 0 };
  const byCat = new Map<string, number>();
  for (const r of rows) {
    const t = eff(r);
    if (t === "INCOME_MANUAL" || t === "INCOME_INVOICE") {
      f.revenueCashCents += r.cashDeltaCents;
      f.revenueBankCents += r.bankDeltaCents;
      continue;
    }
    let cost = 0;
    if (t === "EXPENSE" || t === "PARTNER_EXPENSE") {
      f.costsCashCents -= r.cashDeltaCents;
      f.costsBankCents -= r.bankDeltaCents;
      const other = -(r.walletDeltaCents + r.partnerDeltaCents);
      f.costsOtherCents += other;
      cost = -(r.cashDeltaCents + r.bankDeltaCents) + other;
    } else if (t === "RECEIPT" || t === "ADJUSTMENT") {
      cost = -r.walletDeltaCents;
      f.costsOtherCents += cost;
    } else continue;
    const k = r.category ?? (t === "RECEIPT" ? "Belege von Mitarbeitern" : t === "ADJUSTMENT" ? "Ausgaben ohne Beleg" : "SONSTIGES");
    byCat.set(k, (byCat.get(k) ?? 0) + cost);
  }
  const revenueCents = f.revenueCashCents + f.revenueBankCents;
  const costsCents = f.costsCashCents + f.costsBankCents + f.costsOtherCents;
  return {
    ...f, revenueCents, costsCents, resultCents: revenueCents - costsCents,
    costsByCategory: [...byCat].filter(([, c]) => c !== 0)
      .map(([category, cents]) => ({ category, label: categoryLabel(category), cents }))
      .sort((a, b) => b.cents - a.cents),
  };
}

export interface BranchBalanceRow {
  key: string;
  name: string;
  incomeCents: number;
  expenseCents: number;
  cashOpeningCents: number;
  bankOpeningCents: number;
  cashClosingCents: number;
  bankClosingCents: number;
  resultCents: number;
}

export interface SnapshotRow extends BranchRow {
  id?: string;
  reversalOfId?: string | null;
}

/** Kasse/Bank-Bestand + GuV einer Filiale: Opening vor dem Zeitraum + Bewegungen nur dieser Filiale. */
export function branchBalanceSnapshot(
  key: string,
  name: string,
  opening: { cashCents: number; bankCents: number },
  rows: SnapshotRow[],
  inRange: Set<string>,
): BranchBalanceRow {
  const flow = rows.map((r) => ({ ...r, type: flowType(r, inRange) }));
  const cash = accountFlow("CASH", opening.cashCents, flow);
  const bank = accountFlow("BANK", opening.bankCents, flow);
  const fig = branchFigures(rows);
  return {
    key,
    name,
    incomeCents: fig.revenueCents,
    expenseCents: fig.costsCents,
    cashOpeningCents: cash.openingCents,
    bankOpeningCents: bank.openingCents,
    cashClosingCents: cash.closingCents,
    bankClosingCents: bank.closingCents,
    resultCents: fig.resultCents,
  };
}

/** Monatstitel, wenn Von der 1. des Monats ist und Bis im selben Monat liegt. */
export function reportPeriodLabel(from: string, to: string): { kind: "month" | "range"; text: string } {
  if (from.endsWith("-01") && from.slice(0, 7) === to.slice(0, 7)) {
    const text = new Date(`${from}T12:00:00Z`).toLocaleDateString("de-DE", {
      month: "long", year: "numeric", timeZone: "Europe/Berlin",
    });
    return { kind: "month", text };
  }
  return {
    kind: "range",
    text: `${fmtDate(new Date(`${from}T12:00:00Z`))} – ${fmtDate(new Date(`${to}T12:00:00Z`))}`,
  };
}

/**
 * Dokumentenkopf für Monatsbericht / PDF.
 * Filiale: "Monatsbericht November 2026 – Filiale Frankfurt"
 * Gesamt:  "Konsolidierter Monatsbericht – Alle Filialen"
 */
export function reportScopeTitle(
  from: string, to: string,
  opts: { branchName?: string | null; unassigned?: boolean } = {},
): string {
  const p = reportPeriodLabel(from, to);
  const monthish = p.kind === "month";
  if (opts.unassigned) {
    return monthish
      ? `Monatsbericht ${p.text} – ${UNASSIGNED_BRANCH_NAME}`
      : `Bericht ${p.text} – ${UNASSIGNED_BRANCH_NAME}`;
  }
  if (opts.branchName) {
    return monthish
      ? `Monatsbericht ${p.text} – Filiale ${opts.branchName}`
      : `Bericht ${p.text} – Filiale ${opts.branchName}`;
  }
  return monthish ? "Konsolidierter Monatsbericht – Alle Filialen" : "Konsolidierter Bericht – Alle Filialen";
}

/** Große erste Zeile im Filial-PDF, z. B. "Filiale: Wiesbaden". */
export function branchHeadline(opts: { branchName?: string | null; unassigned?: boolean } = {}): string | null {
  if (opts.unassigned) return `Filiale: ${UNASSIGNED_BRANCH_NAME}`;
  if (opts.branchName) return `Filiale: ${opts.branchName}`;
  return null;
}

/** Dokumententitel des Filial-Einzelberichts. */
export function branchReportTitle(opts: { branchName?: string | null; unassigned?: boolean } = {}): string {
  if (opts.unassigned) return `Filialbericht & Monatsabschluss: ${UNASSIGNED_BRANCH_NAME}`;
  if (opts.branchName) return `Filialbericht & Monatsabschluss: Filiale ${opts.branchName}`;
  return "Filialbericht & Monatsabschluss";
}

export interface BranchReport {
  branch: { id: string; name: string; unassigned: boolean };
  from: string;
  to: string;
  figures: BranchFigures;
  cash: AccountFlow;
  bank: AccountFlow;
  statements: string[];
}

/** Einzelbericht einer Filiale: Kasse, Bank, GuV – nur Bewegungen dieses Standorts. */
export function buildBranchReport(input: {
  branch: { id: string; name: string; unassigned?: boolean };
  from: string;
  to: string;
  opening: { cashCents: number; bankCents: number };
  rows: SnapshotRow[];
}): BranchReport {
  const unassigned = input.branch.unassigned === true || input.branch.id === UNASSIGNED_BRANCH;
  const inRange = new Set(input.rows.map((r) => r.id).filter((id): id is string => !!id));
  const flow = input.rows.map((r) => ({ ...r, type: flowType(r, inRange) }));
  const cash = accountFlow("CASH", input.opening.cashCents, flow);
  const bank = accountFlow("BANK", input.opening.bankCents, flow);
  const figures = branchFigures(input.rows);
  return {
    branch: { id: input.branch.id, name: input.branch.name, unassigned },
    from: input.from, to: input.to, figures, cash, bank,
    statements: [
      `Umsatz Kasse (Bar): ${formatCents(figures.revenueCashCents)}`,
      `Umsatz Bankkonto: ${formatCents(figures.revenueBankCents)}`,
      `Gesamtausgaben der Filiale: ${formatCents(figures.costsCents)}`,
      `Kassen-Endbestand: ${formatCents(cash.closingCents)}`,
      `Bank-Endbestand: ${formatCents(bank.closingCents)}`,
      `Ergebnis / Gewinn: ${formatCents(figures.resultCents)}`,
    ],
  };
}

function fileSlug(name: string) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss")
    .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Dateiname ohne Endung: Monatsbericht_Frankfurt_2026-11-01_2026-11-08 */
export function reportFileStem(
  from: string, to: string, kind: "gesamt" | "zentral" | { branch: string }, prefix = "Monatsbericht",
): string {
  const period = from === to ? from : `${from}_${to}`;
  if (kind === "gesamt") return `${prefix}_Gesamt_${period}`;
  if (kind === "zentral") return `${prefix}_Zentral_Ohne_Filiale_${period}`;
  return `${prefix}_${fileSlug(kind.branch)}_${period}`;
}

/** PDF-Link einer Filiale (stem=filialbericht → Dateiname Filialbericht_Wiesbaden_…). */
export function branchPdfUrl(branchId: string, from: string, to: string, stem: "monatsbericht" | "filialbericht" = "monatsbericht") {
  const q = new URLSearchParams({ from, to });
  if (stem === "filialbericht") q.set("stem", "filialbericht");
  return `/api/v1/reports/branch/${branchId}?${q}`;
}
