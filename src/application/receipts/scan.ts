// KI-Beleglesung mit Google Gemini: Foto/PDF → strukturierter Buchungsvorschlag.
// Es wird nichts gespeichert oder gebucht; der Aufrufer zeigt den Vorschlag zur Bestätigung an.
import { GoogleGenAI, Type } from "@google/genai";
import { AppError } from "@/domain/errors";
import { SCAN_CATEGORY_LABELS, scanResultFromJson, type ScanResult } from "@/domain/ocr";

/**
 * Überschreibbar per GEMINI_MODEL. gemini-2.5-flash ist für neue API-Keys nicht mehr verfügbar (von Google abgeschaltet);
 * gemini-3.5-flash wurde mit Belegen getestet (ca. 5 s, korrekte Beträge/MwSt).
 */
export const DEFAULT_SCAN_MODEL = "gemini-3.5-flash";

export const SCAN_PROMPT = `Analysiere diesen Kassenbeleg bzw. diese Rechnung (Deutschland, Gastronomie-Betrieb).
Extrahiere die folgenden Daten als valides JSON:
{
  "date": "YYYY-MM-DD",
  "merchant": "Name des Händlers / Geschäfts (z. B. Metro, REWE, Shell)",
  "totalGross": 0.00,
  "vatRate": 7 oder 19,
  "vatAmount": 0.00,
  "category": "${SCAN_CATEGORY_LABELS.join('" | "')}",
  "description": "Kurze Beschreibung des Einkaufs",
  "paymentMethod": "CASH" | "CARD" | null
}
Regeln:
- totalGross ist der Endbetrag, den der Kunde brutto bezahlt hat (nicht Netto, nicht "gegeben", nicht Rückgeld), als Zahl mit Punkt, z. B. 12.50.
- vatRate ist der überwiegende Steuersatz in Prozent (7 oder 19). Bei gemischten Sätzen den Satz mit dem höheren Warenwert; vatAmount ist die Summe der ausgewiesenen MwSt.
- Wähle category exakt aus der vorgegebenen Liste. Tankbelege = "Treibstoff".
- paymentMethod: "CASH" bei Barzahlung, "CARD" bei Karte/EC/Kreditkarte, sonst null.
- Wenn ein Wert nicht sicher lesbar ist, gib null zurück. Erfinde nichts.`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    date: { type: Type.STRING, nullable: true, description: "YYYY-MM-DD" },
    merchant: { type: Type.STRING, nullable: true },
    totalGross: { type: Type.NUMBER, nullable: true },
    vatRate: { type: Type.NUMBER, nullable: true, description: "7 oder 19" },
    vatAmount: { type: Type.NUMBER, nullable: true },
    category: { type: Type.STRING, nullable: true, enum: [...SCAN_CATEGORY_LABELS] },
    description: { type: Type.STRING, nullable: true },
    paymentMethod: { type: Type.STRING, nullable: true, enum: ["CASH", "CARD"] },
  },
  required: ["date", "merchant", "totalGross", "vatRate", "vatAmount", "category", "description", "paymentMethod"],
};

let client: GoogleGenAI | null = null;
function getClient(apiKey: string) {
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export function scanConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY?.trim();
}

export async function scanReceipt(file: { data: Buffer; mime: string }): Promise<ScanResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new AppError(503, "SCAN_UNAVAILABLE", "Die KI-Belegerkennung ist nicht eingerichtet.");
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_SCAN_MODEL;
  try {
    const res = await getClient(apiKey).models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: file.mime, data: file.data.toString("base64") } },
          { text: SCAN_PROMPT },
        ],
      }],
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema,
        httpOptions: { timeout: 25_000 },
      },
    });
    const text = res.text;
    if (!text) throw new Error("leere Antwort");
    return scanResultFromJson(JSON.parse(text));
  } catch (e) {
    // Keine Details (Key, Request) ins Log – nur Art und Meldung
    console.error("[scan-receipt] Gemini-Fehler", { model, name: (e as Error)?.name, message: (e as Error)?.message?.slice(0, 300) });
    throw new AppError(502, "SCAN_FAILED", "Der Beleg konnte nicht automatisch gelesen werden.");
  }
}
