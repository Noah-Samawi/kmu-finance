// Geld wird überall als ganze Zahl in Cent geführt.
// Nur an den Rändern (Eingabe / Anzeige) wird umgewandelt.

/** Kaufmännisch runden (0,5 -> weg von 0). Math.round rundet -0,5 zu 0. */
export function roundHalfAway(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/**
 * Wandelt eine Euro-Eingabe in Cent um.
 * Akzeptiert "1.234,56", "1234,56", "1234.56", "12" und Zahlen.
 */
export function parseEuroToCents(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error("Ungültiger Betrag");
    return roundHalfAway(input * 100);
  }
  let s = input.trim().replace(/\s|€/g, "");
  if (!s) throw new Error("Betrag fehlt");
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  if (s.includes(",")) {
    // deutsches Format: Punkte sind Tausendertrenner
    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) {
    // "1.234.567" oder "15.000" -> Punkte sind Tausendertrenner (deutsche Eingabe)
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Ungültiger Betrag: ${input}`);
  const [euros, cents = ""] = s.split(".");
  const value = Number(euros) * 100 + Number(cents.padEnd(2, "0"));
  return neg ? -value : value;
}

const fmt = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/** 123456 -> "1.234,56 €" */
export function formatCents(cents: number): string {
  return fmt.format(cents / 100);
}

/** 123456 -> "1234,56" (für CSV/Eingabefelder) */
export function centsToPlain(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Basispunkte -> Prozent-Text: 1900 -> "19 %" */
export function formatVatRate(bp: number): string {
  return `${(bp / 100).toLocaleString("de-DE")} %`;
}
