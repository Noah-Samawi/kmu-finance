// MwSt. bei Einnahmen/Ausgaben: Betrag als Brutto oder Netto eingeben,
// Kasse/Bank buchen immer den Zahlungsbetrag (Brutto), MwSt. wird getrennt geführt.
import { roundHalfAway } from "./money";
import { isAllowedVatRate, parseVatRate } from "./invoice";
import { rule } from "./errors";

export type VatMode = "GROSS" | "NET";

export interface VatSplit {
  /** Betrag, der tatsächlich fließt (Kasse/Bank) */
  grossCents: number;
  /** Netto ohne MwSt. */
  netCents: number;
  /** MwSt.-Betrag (absolut) */
  vatCents: number;
  /** Basispunkte 0–2000 */
  vatRate: number;
  mode: VatMode;
}

/** Aus Eingabebetrag + Satz + Modus die drei Beträge berechnen. vatRateBp = 0 → keine MwSt. */
export function splitVat(amountCents: number, vatRateBp: number, mode: VatMode): VatSplit {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw rule("Betrag muss größer als 0 sein");
  if (!isAllowedVatRate(vatRateBp)) throw rule("USt.-Satz: 0 % bis 20 %");
  if (vatRateBp === 0) return { grossCents: amountCents, netCents: amountCents, vatCents: 0, vatRate: 0, mode };
  if (mode === "GROSS") {
    const net = roundHalfAway((amountCents * 10000) / (10000 + vatRateBp));
    return { grossCents: amountCents, netCents: net, vatCents: amountCents - net, vatRate: vatRateBp, mode };
  }
  const vat = roundHalfAway((amountCents * vatRateBp) / 10000);
  return { grossCents: amountCents + vat, netCents: amountCents, vatCents: vat, vatRate: vatRateBp, mode };
}

/**
 * Vorzeichen für das MwSt.-Konto:
 *  Einnahme  → +vatCents (MwSt. Einnahmen / Umsatzsteuer-Schuld)
 *  Ausgabe   → −vatCents (MwSt. Ausgaben / Vorsteuer)
 * Saldo = SUM(vatCents) = was dem Finanzamt ungefähr geschuldet wird.
 */
export function vatLedgerSign(kind: "INCOME" | "EXPENSE", vatCents: number): number {
  if (!vatCents) return 0;
  return kind === "INCOME" ? Math.abs(vatCents) : -Math.abs(vatCents);
}

export function parseVatMode(v: unknown): VatMode {
  const s = String(v ?? "GROSS").toUpperCase();
  if (s === "NET" || s === "NETTO") return "NET";
  return "GROSS";
}

/** Formularfelder → Split; leerer/fehlender Satz = 0 % */
export function vatFromForm(amountCents: number, vatRateRaw: unknown, modeRaw: unknown): VatSplit {
  const rate = vatRateRaw === "" || vatRateRaw == null ? 0 : parseVatRate(vatRateRaw);
  return splitVat(amountCents, rate, parseVatMode(modeRaw));
}
