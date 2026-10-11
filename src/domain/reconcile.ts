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

export function parseBankFile(filename: string, mime: string, data: Buffer): ParsedBankLine[] {
  const name = filename.toLowerCase();
  const text = data.toString("utf8");
  if (name.endsWith(".ofx") || name.endsWith(".qfx") || mime.includes("ofx") || /<OFX>/i.test(text)) {
    return parseBankOfx(text);
  }
  return parseBankCsv(text);
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

export function matchBankLine(
  line: ParsedBankLine,
  invoices: MatchCandidate[],
  receipts: MatchCandidate[],
): { status: "GREEN" | "RED" | "CASH_WITHDRAWAL"; invoiceId?: string; receiptId?: string } {
  if (line.amountCents < 0 && isCashWithdrawal(line.purpose, line.payee)) {
    return { status: "CASH_WITHDRAWAL" };
  }
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
