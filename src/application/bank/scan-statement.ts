// Kontoauszug per KI (Gemini) lesen – Text-PDFs und Scans/Fotos.
// Liefert Umsätze + Anfangs-/Endsaldo; gebucht wird erst nach Bestätigung.
import { createHash } from "node:crypto";
import { GoogleGenAI, Type } from "@google/genai";
import { AppError } from "@/domain/errors";
import { parseEuroToCents } from "@/domain/money";
import { DEFAULT_SCAN_MODEL, scanConfigured } from "@/application/receipts/scan";
import type { ParsedBankLine } from "@/domain/reconcile";

export interface BankScanResult {
  lines: ParsedBankLine[];
  openingCents: number | null;
  closingCents: number | null;
  source: "gemini" | "text";
}

const PROMPT = `Analysiere diesen deutschen Bank-Kontoauszug (auch Scan/Foto, auch mehrseitig).
Extrahiere ALLE Umsätze und die Salden als valides JSON:
{
  "openingBalance": 0.00,
  "closingBalance": 0.00,
  "transactions": [
    { "date": "YYYY-MM-DD", "amount": -12.50, "payee": "Empfänger/Auftraggeber", "purpose": "Verwendungszweck", "iban": null }
  ]
}
Regeln:
- amount ist positiv bei Gutschrift/Eingang, negativ bei Abbuchung/Ausgang (Punkt als Dezimaltrennzeichen).
- Jede Zeile einzeln; keine Zusammenfassungen, keine Saldo-Zeilen als Umsatz.
- openingBalance = Anfangssaldo (Kontostand zu Beginn), closingBalance = Endsaldo. Wenn nicht lesbar: null.
- Erfinde nichts. Bei Unsicherheit Betrag/Datum weglassen.`;

const schema = {
  type: Type.OBJECT,
  properties: {
    openingBalance: { type: Type.NUMBER, nullable: true },
    closingBalance: { type: Type.NUMBER, nullable: true },
    transactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          date: { type: Type.STRING, nullable: true },
          amount: { type: Type.NUMBER, nullable: true },
          payee: { type: Type.STRING, nullable: true },
          purpose: { type: Type.STRING, nullable: true },
          iban: { type: Type.STRING, nullable: true },
        },
      },
    },
  },
  required: ["transactions"],
};

function money(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  if (typeof v === "string" && v.trim()) {
    try { return parseEuroToCents(v); } catch { return null; }
  }
  return null;
}

function validDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[0] : null;
}

export function fileSha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Kontoauszug-PDF/Bild mit Gemini lesen */
export async function scanBankStatementAi(file: { data: Buffer; mime: string }): Promise<BankScanResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AppError(503, "SCAN_UNAVAILABLE", "Die KI-Belegerkennung ist nicht eingerichtet.");
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_SCAN_MODEL;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: file.mime, data: file.data.toString("base64") } },
          { text: PROMPT },
        ],
      }],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: schema,
        httpOptions: { timeout: 55_000 },
      },
    });
    const text = res.text;
    if (!text) throw new Error("leere Antwort");
    const raw = JSON.parse(text) as {
      openingBalance?: unknown; closingBalance?: unknown;
      transactions?: { date?: unknown; amount?: unknown; payee?: unknown; purpose?: unknown; iban?: unknown }[];
    };
    const lines: ParsedBankLine[] = [];
    for (const t of raw.transactions ?? []) {
      const date = validDate(t.date);
      const amountCents = money(t.amount);
      if (!date || !amountCents) continue;
      lines.push({
        bookingDate: date,
        amountCents,
        payee: typeof t.payee === "string" ? t.payee.slice(0, 120) : "",
        purpose: typeof t.purpose === "string" ? t.purpose.slice(0, 300) : "",
        iban: typeof t.iban === "string" ? t.iban.slice(0, 34) : "",
      });
    }
    if (!lines.length) throw new Error("keine Umsätze");
    return {
      lines,
      openingCents: money(raw.openingBalance),
      closingCents: money(raw.closingBalance),
      source: "gemini",
    };
  } catch (e) {
    console.error("[scan-statement] Gemini-Fehler", { model, message: (e as Error)?.message?.slice(0, 300) });
    throw new AppError(502, "SCAN_FAILED", "Der Kontoauszug konnte nicht automatisch gelesen werden.");
  }
}

export { scanConfigured };
