// Filial-Auswertung: Umsätze (Kasse/Bank getrennt) und Kosten je Standort.
// Die Konten laufen zentral – die Filiale ist eine Zuordnung je Buchung.
import { categoryLabel } from "./cash";
import type { LedgerType } from "./ledger";

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
