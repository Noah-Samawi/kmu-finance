// Such- und Filterleiste für Bewegungslisten (Kasse & Bank, Berichte, Filialen)
import { categoryLabel, entryLabel } from "./cash";
import { LEDGER_LABEL, type LedgerType } from "./ledger";
import { formatCents } from "./money";

export interface LedgerFilter {
  /** Freitext: Zweck, Person, Kategorie, Filiale, Buchungsart, Betrag */
  q?: string;
  /** Filial-ID oder "none" (ohne Filiale) */
  branchId?: string;
  personId?: string;
  account?: "CASH" | "BANK";
  kind?: "INCOME" | "EXPENSE" | "OTHER";
}

export interface FilterableRow {
  type: LedgerType; reversedType?: LedgerType | null;
  description: string | null; employeeId: string | null; employeeName: string | null;
  category: string | null; branchId?: string | null; branchName?: string | null;
  accountKind: "CASH" | "BANK" | null;
  cashDeltaCents: number; bankDeltaCents: number; walletDeltaCents: number; partnerDeltaCents: number; poolDeltaCents: number;
}

const INCOME_TYPES: LedgerType[] = ["INCOME_MANUAL", "INCOME_INVOICE"];
const EXPENSE_TYPES: LedgerType[] = ["EXPENSE", "PARTNER_EXPENSE", "RECEIPT", "ADJUSTMENT"];

export function kindOf(r: Pick<FilterableRow, "type" | "reversedType">): "INCOME" | "EXPENSE" | "OTHER" {
  const t = r.type === "REVERSAL" ? r.reversedType ?? "REVERSAL" : r.type;
  return INCOME_TYPES.includes(t) ? "INCOME" : EXPENSE_TYPES.includes(t) ? "EXPENSE" : "OTHER";
}

const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

function haystack(r: FilterableRow): string {
  const t = r.type === "REVERSAL" && r.reversedType ? r.reversedType : r.type;
  const amounts = [r.cashDeltaCents, r.bankDeltaCents, r.walletDeltaCents, r.partnerDeltaCents]
    .filter(Boolean).map((c) => `${formatCents(Math.abs(c))} ${(Math.abs(c) / 100).toFixed(2).replace(".", ",")}`);
  return fold([
    r.description, r.employeeName, r.category && categoryLabel(r.category), r.branchName,
    entryLabel(t, LEDGER_LABEL[t], r), r.type === "REVERSAL" ? "storno" : "", ...amounts,
  ].filter(Boolean).join(" "));
}

/** Alle Suchbegriffe müssen vorkommen (UND-Verknüpfung), Groß/Klein und Akzente egal */
export function filterLedgerRows<T extends FilterableRow>(rows: T[], f: LedgerFilter): T[] {
  const terms = fold(f.q ?? "").split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (f.branchId && (f.branchId === "none" ? !!r.branchId : r.branchId !== f.branchId)) return false;
    if (f.personId && r.employeeId !== f.personId) return false;
    if (f.account === "CASH" && !r.cashDeltaCents) return false;
    if (f.account === "BANK" && !r.bankDeltaCents) return false;
    if (f.kind && kindOf(r) !== f.kind) return false;
    if (terms.length) {
      const h = haystack(r);
      if (!terms.every((t) => h.includes(t))) return false;
    }
    return true;
  });
}

export function parseLedgerFilter(sp: Record<string, string | undefined>): LedgerFilter {
  const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) => (allowed.includes(v as T) ? (v as T) : undefined);
  return {
    q: sp.q?.trim().slice(0, 100) || undefined,
    branchId: sp.branch || undefined,
    personId: sp.person || undefined,
    account: pick(sp.account, ["CASH", "BANK"] as const),
    kind: pick(sp.kind, ["INCOME", "EXPENSE", "OTHER"] as const),
  };
}

export const isFiltered = (f: LedgerFilter) => !!(f.q || f.branchId || f.personId || f.account || f.kind);
