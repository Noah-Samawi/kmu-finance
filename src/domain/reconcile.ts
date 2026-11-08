import { guessCategory } from "./cash";
import { parseEuroToCents } from "./money";

export interface ParsedBankLine {
  bookingDate: string;
  amountCents: number;
  payee: string;
  purpose: string;
  iban: string;
}

const CASH_ATM = /geldautomat|\batm\b|bargeldabhebung|cash\s*withdraw|auszahlung\s*(ga|automat)/i;

export function isCashWithdrawal(purpose: string, payee: string): boolean {
  return CASH_ATM.test(`${purpose} ${payee}`);
}

function parseDeDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const iso = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (!q && c === sep) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseBankCsv(text: string): ParsedBankLine[] {
  const raw = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (raw.length < 2) return [];
  const sep = (raw[0].match(/;/g)?.length ?? 0) >= (raw[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const header = splitCsvLine(raw[0], sep).map((h) => h.toLowerCase());
  const idx = (names: string[]) => names.map((n) => header.findIndex((h) => h.includes(n))).find((i) => i >= 0) ?? -1;
  const iDate = idx(["buchungstag", "buchungsdatum", "datum", "date"]);
  const iAmount = idx(["betrag", "amount", "umsatz"]);
  const iPayee = idx(["beguenstigter", "begünstigter", "auftraggeber", "empfänger", "name", "payee"]);
  const iPurpose = idx(["verwendungszweck", "zweck", "purpose", "text"]);
  const iIban = idx(["iban"]);
  const lines: ParsedBankLine[] = [];
  for (const row of raw.slice(1)) {
    const c = splitCsvLine(row, sep);
    const date = iDate >= 0 ? parseDeDate(c[iDate] ?? "") : null;
    if (!date) continue;
    let amount = 0;
    try { amount = parseEuroToCents((c[iAmount] ?? "0").replace(/\s/g, "")); } catch { continue; }
    if (!amount) continue;
    lines.push({
      bookingDate: date,
      amountCents: amount,
      payee: iPayee >= 0 ? c[iPayee] ?? "" : "",
      purpose: iPurpose >= 0 ? c[iPurpose] ?? "" : "",
      iban: iIban >= 0 ? c[iIban] ?? "" : "",
    });
  }
  return lines;
}

export function parseBankOfx(text: string): ParsedBankLine[] {
  const chunks = text.split(/<STMTTRN>/i).slice(1);
  const lines: ParsedBankLine[] = [];
  for (const ch of chunks) {
    const dt = ch.match(/<DTPOSTED>(\d{8})/i)?.[1];
    const amt = ch.match(/<TRNAMT>([-0-9.]+)/i)?.[1];
    const name = ch.match(/<NAME>([^<\n]+)/i)?.[1]?.trim() ?? "";
    const memo = ch.match(/<MEMO>([^<\n]+)/i)?.[1]?.trim() ?? "";
    if (!dt || !amt) continue;
    const date = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    const amountCents = Math.round(Number(amt) * 100);
    if (!amountCents) continue;
    lines.push({ bookingDate: date, amountCents, payee: name, purpose: memo, iban: "" });
  }
  return lines;
}

const PDF_LINE = /^(\d{1,2}\.\d{1,2}\.(?:\d{2,4})?)\s+(?:(\d{1,2}\.\d{1,2}\.(?:\d{2,4})?)\s+)?(.*?)\s*([+-]\s?)?(\d{1,3}(?:\.\d{3})*,\d{2})\s*(-|\+|S|H)?$/;
const PDF_SKIP = /\b(saldo|kontostand|übertrag|uebertrag|summe\s+(soll|haben)|seite\s+\d)/i;
const OUTGOING_HINT = /\b(lastschrift|abbuchung|überweisung\s+an|ueberweisung\s+an|kartenzahlung|kartenumsatz|entgelt|gebühr|gebuehr|dauerauftrag|auszahlung|geldautomat)\b/i;

/**
 * Kontoauszug als PDF: Text (zeilenweise aus der PDF-Textebene) → Umsätze.
 * Erkennt "TT.MM.(JJJJ) [Valuta] Text Betrag" mit Vorzeichen, nachgestelltem Minus oder S/H (Soll/Haben).
 */
export function parseBankPdfText(text: string, periodMonth?: string): ParsedBankLine[] {
  const year = periodMonth?.slice(0, 4) ?? String(new Date().getFullYear());
  const lines: ParsedBankLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.replace(/\s+/g, " ").trim();
    if (!l) continue;
    const m = l.match(PDF_LINE);
    if (!m) {
      const last = lines.at(-1);
      if (last && !PDF_SKIP.test(l) && !/^\d{1,2}\.\d{1,2}\./.test(l) && last.purpose.length < 250) {
        last.purpose = `${last.purpose} ${l}`.trim();
      }
      continue;
    }
    if (PDF_SKIP.test(m[3])) continue;
    const [d, mo, yRaw] = m[1].split(".");
    const y = !yRaw ? year : yRaw.length === 2 ? `20${yRaw}` : yRaw;
    const date = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    let cents: number;
    try { cents = parseEuroToCents(m[5]); } catch { continue; }
    if (!cents) continue;
    const neg = m[4]?.trim() === "-" || m[6] === "-" || m[6] === "S"
      || (!m[4] && !m[6] && OUTGOING_HINT.test(m[3]));
    const purpose = m[3].trim();
    lines.push({ bookingDate: date, amountCents: neg ? -cents : cents, payee: purpose.slice(0, 80), purpose, iban: "" });
  }
  return lines;
}

export function parseBankFile(filename: string, mime: string, data: Buffer, periodMonth?: string): ParsedBankLine[] {
  const name = filename.toLowerCase();
  const text = data.toString("utf8");
  if (name.endsWith(".ofx") || name.endsWith(".qfx") || mime.includes("ofx") || /<OFX>/i.test(text)) {
    return parseBankOfx(text);
  }
  if (name.endsWith(".pdf.txt") || mime === "text/x-pdf-text") return parseBankPdfText(text, periodMonth);
  return parseBankCsv(text);
}

/** Vorschlag für die automatische Verbuchung eines nicht zugeordneten Umsatzes */
export function autoPosting(line: ParsedBankLine): { type: "INCOME_MANUAL" | "EXPENSE"; category: string | null; description: string } {
  const text = [line.payee, line.purpose].filter(Boolean).join(" · ").slice(0, 240);
  if (line.amountCents > 0) return { type: "INCOME_MANUAL", category: null, description: `Kontoauszug: ${text || "Gutschrift"}` };
  return { type: "EXPENSE", category: guessCategory(text) ?? "SONSTIGES", description: `Kontoauszug: ${text || "Abbuchung"}` };
}

export interface MatchCandidate {
  id: string;
  amountCents: number;
  dateKey: string;
}

export function datesClose(a: string, b: string, days = 3): boolean {
  const da = Date.parse(`${a}T12:00:00Z`);
  const db = Date.parse(`${b}T12:00:00Z`);
  return Number.isFinite(da) && Number.isFinite(db) && Math.abs(da - db) <= days * 86400000;
}

/**
 * Ampel: Blau = Geldtransit Bank → Kasse, Grün = passt zu vorhandener Bankbuchung/Rechnung/Beleg,
 * Rot = noch nicht im Hauptbuch (wird bei Auto-Verbuchung zu "verbucht").
 * Bereits zugeordnete Hauptbuchzeilen (usedLedger) werden nicht doppelt verwendet.
 */
export function matchBankLine(
  line: ParsedBankLine,
  invoices: MatchCandidate[],
  receipts: MatchCandidate[],
  ledger: MatchCandidate[] = [],
  usedLedger: Set<string> = new Set(),
): { status: "GREEN" | "RED" | "CASH_WITHDRAWAL"; invoiceId?: string; receiptId?: string; ledgerId?: string } {
  if (line.amountCents < 0 && isCashWithdrawal(line.purpose, line.payee)) {
    const hit = ledger.find((l) => !usedLedger.has(l.id) && l.amountCents === line.amountCents && datesClose(l.dateKey, line.bookingDate, 2));
    if (hit) return { status: "GREEN", ledgerId: hit.id };
    return { status: "CASH_WITHDRAWAL" };
  }
  const own = ledger.find((l) => !usedLedger.has(l.id) && l.amountCents === line.amountCents && datesClose(l.dateKey, line.bookingDate));
  if (own) return { status: "GREEN", ledgerId: own.id };
  if (line.amountCents > 0) {
    const hit = invoices.find((i) => i.amountCents === line.amountCents && datesClose(i.dateKey, line.bookingDate));
    if (hit) return { status: "GREEN", invoiceId: hit.id };
  }
  if (line.amountCents < 0) {
    const abs = -line.amountCents;
    const hit = receipts.find((r) => r.amountCents === abs && datesClose(r.dateKey, line.bookingDate, 4));
    if (hit) return { status: "GREEN", receiptId: hit.id };
  }
  return { status: "RED" };
}
