import { roundHalfAway } from "./money";
import { todayKey } from "./period";

export type InvoiceStatus = "DRAFT" | "OPEN" | "PAID" | "CANCELED";
export type DisplayStatus = InvoiceStatus | "OVERDUE";

export const ALLOWED_VAT_RATES = [0, 700, 1900] as const;

export interface LineInput {
  description: string;
  quantity: string; // Dezimal als String, max. 3 Nachkommastellen ("2.5")
  unit: string;
  unitPriceCents: number; // netto
  vatRate: number; // Basispunkte
}

export interface LineResult extends LineInput {
  position: number;
  lineNetCents: number;
  lineVatCents: number;
}

/** "2.5" -> 2500 (Tausendstel). Vermeidet Float-Fehler bei Mengen. */
export function quantityToMilli(q: string): number {
  const s = q.trim().replace(",", ".");
  if (!/^-?\d+(\.\d{1,3})?$/.test(s)) throw new Error(`Ungültige Menge: ${q}`);
  const neg = s.startsWith("-");
  const [i, f = ""] = s.replace("-", "").split(".");
  const v = Number(i) * 1000 + Number(f.padEnd(3, "0"));
  return neg ? -v : v;
}

export function calcLine(line: LineInput, position: number): LineResult {
  const milli = quantityToMilli(line.quantity);
  const lineNetCents = roundHalfAway((milli * line.unitPriceCents) / 1000);
  const lineVatCents = roundHalfAway((lineNetCents * line.vatRate) / 10000);
  return { ...line, position, lineNetCents, lineVatCents };
}

/**
 * Summen je Position berechnen und aufaddieren.
 * smallBusiness (§ 19 UStG): alle Steuersätze werden 0.
 */
export function calcInvoice(lines: LineInput[], smallBusiness: boolean) {
  const items = lines.map((l, i) =>
    calcLine({ ...l, vatRate: smallBusiness ? 0 : l.vatRate }, i + 1),
  );
  const netCents = items.reduce((s, i) => s + i.lineNetCents, 0);
  const vatCents = items.reduce((s, i) => s + i.lineVatCents, 0);
  return { items, netCents, vatCents, grossCents: netCents + vatCents };
}

/** USt. je Steuersatz – Pflichtangabe auf der Rechnung */
export function vatBreakdown(items: { vatRate: number; lineNetCents: number; lineVatCents: number }[]) {
  const map = new Map<number, { net: number; vat: number }>();
  for (const i of items) {
    const cur = map.get(i.vatRate) ?? { net: 0, vat: 0 };
    cur.net += i.lineNetCents;
    cur.vat += i.lineVatCents;
    map.set(i.vatRate, cur);
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([rate, v]) => ({ rate, ...v }));
}

export function formatInvoiceNumber(prefix: string, year: number, n: number): string {
  return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}

/** Überfällig = offen und Fälligkeitstag (deutsche Zeit) liegt vor heute */
export function isOverdue(status: InvoiceStatus, dueDate: Date | null, now = new Date()): boolean {
  return status === "OPEN" && !!dueDate && todayKey(dueDate) < todayKey(now);
}

export function displayStatus(status: InvoiceStatus, dueDate: Date | null, now = new Date()): DisplayStatus {
  return isOverdue(status, dueDate, now) ? "OVERDUE" : status;
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  DRAFT: "Entwurf",
  OPEN: "Offen",
  PAID: "Bezahlt",
  OVERDUE: "Überfällig",
  CANCELED: "Storniert",
};

// Erlaubte Statusübergänge
export const canEdit = (s: InvoiceStatus) => s === "DRAFT";
export const canIssue = (s: InvoiceStatus) => s === "DRAFT";
export const canMarkPaid = (s: InvoiceStatus) => s === "OPEN";
export const canCancel = (s: InvoiceStatus) => s === "OPEN" || s === "PAID";
