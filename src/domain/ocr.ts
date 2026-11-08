// Auswertung von OCR-Text (Kassenbon, Rechnung): Lieferant, Betrag, Datum, Zahlungsart → Buchungsvorschlag.
// Die Texterkennung selbst läuft im Browser (Foto: Tesseract, PDF: Textebene/Tesseract).
import { guessCategory, type ExpenseCategory } from "./cash";

export type PaymentKind = "CASH" | "CARD";

export interface ReceiptSuggestion {
  merchant: string | null;
  amountCents: number | null;
  /** JJJJ-MM-TT */
  date: string | null;
  payment: PaymentKind | null;
  /** Basispunkte: 1900 / 700 */
  vatRate: number | null;
  category: ExpenseCategory | null;
}

const KNOWN_MERCHANTS = [
  "METRO", "SELGROS", "TRANSGOURMET", "EDEKA", "REWE", "LIDL", "ALDI", "KAUFLAND", "PENNY", "NETTO",
  "IKEA", "BAUHAUS", "OBI", "HORNBACH", "MEDIA MARKT", "SATURN", "DM", "ROSSMANN", "ACTION", "TEDI",
  "SHELL", "ARAL", "ESSO", "TOTAL", "JET", "AMAZON", "STADTWERKE", "MAINOVA", "SÜWAG",
];

// 1.234,56 | 1234,56 | 12,50 | 12.50 | 1 234,56 (OCR liest Tausenderpunkte gelegentlich als Leerzeichen)
const AMOUNT = /(?<![\d,.])(\d{1,3}(?:[.\s]\d{3})+|\d+)[,.](\d{2})(?![\d])/g;

export function amountsIn(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(AMOUNT)) {
    const euros = Number(m[1].replace(/[.\s]/g, ""));
    if (Number.isFinite(euros)) out.push(euros * 100 + Number(m[2]));
  }
  return out;
}

const TOTAL_HINT = /\b(zu\s*zahlen|gesamtbetrag|gesamtsumme|endsumme|endbetrag|rechnungsbetrag|summe|total|gesamt|betrag\s*eur|brutto)\b/i;
const NOT_TOTAL = /\b(gegeben|rückgeld|rueckgeld|wechselgeld|zurück|netto|mwst|ust|steuer|zwischensumme|rabatt|pfand\s*zurück)\b/i;

function pickAmount(lines: string[]): number | null {
  const hinted = lines.filter((l) => TOTAL_HINT.test(l) && !NOT_TOTAL.test(l)).flatMap(amountsIn).filter((c) => c > 0);
  if (hinted.length) return Math.max(...hinted);
  const all = lines.filter((l) => !NOT_TOTAL.test(l)).flatMap(amountsIn).filter((c) => c > 0 && c < 10_000_000);
  return all.length ? Math.max(...all) : null;
}

function pickDate(text: string): string | null {
  const de = text.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/);
  if (de) {
    const [d, m, y] = [Number(de[1]), Number(de[2]), de[3].length === 2 ? 2000 + Number(de[3]) : Number(de[3])];
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2000 && y <= 2100) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  return iso ? iso[0] : null;
}

const CARD = /\b(karte|kartenzahlung|ec[-\s]?karte|ec[-\s]?cash|girocard|visa|mastercard|maestro|v\s?pay|kreditkarte|debit|kontaktlos|contactless|apple\s*pay|google\s*pay|terminal|trace|beleg-?nr\.?\s*\d+.*kart)/i;
const CASH = /\b(bar|barzahlung|bargeld|gegeben|rückgeld|rueckgeld|wechselgeld|cash)\b/i;

export function detectPayment(text: string): PaymentKind | null {
  const card = CARD.test(text), cash = CASH.test(text);
  if (card && !/\b(gegeben|rückgeld|rueckgeld|wechselgeld)\b/i.test(text)) return "CARD";
  if (cash) return "CASH";
  return card ? "CARD" : null;
}

function pickMerchant(lines: string[]): string | null {
  const upper = lines.join("\n").toUpperCase();
  const known = KNOWN_MERCHANTS.find((k) => new RegExp(`(^|[^A-ZÄÖÜ])${k}([^A-ZÄÖÜ]|$)`).test(upper));
  if (known) return known.charAt(0) + known.slice(1).toLowerCase();
  const candidate = lines.slice(0, 6).find((l) => {
    const letters = (l.match(/[A-Za-zÄÖÜäöüß]/g) ?? []).length;
    return letters >= 3 && !/\d{4,}|str\.|straße|strasse|tel|fax|www\.|@|ust|steuer|datum|uhr|kasse|bon|beleg/i.test(l);
  });
  return candidate ? candidate.replace(/[^\p{L}\p{N}&.,' -]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60) || null : null;
}

function pickVat(text: string): number | null {
  if (/\b19[,.]?0{0,2}\s?%/.test(text)) return 1900;
  if (/\b7[,.]?0{0,2}\s?%/.test(text)) return 700;
  return null;
}

export function parseReceiptText(text: string): ReceiptSuggestion {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const merchant = pickMerchant(lines);
  return {
    merchant,
    amountCents: pickAmount(lines),
    date: pickDate(text),
    payment: detectPayment(text),
    vatRate: pickVat(text),
    category: guessCategory(`${merchant ?? ""} ${text}`),
  };
}
