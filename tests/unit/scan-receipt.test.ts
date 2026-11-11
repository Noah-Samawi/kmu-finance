import { describe, expect, it } from "vitest";
import { scanResultFromJson } from "@/domain/ocr";

describe("KI-Beleglesung: Antwort prüfen und normalisieren", () => {
  it("übernimmt eine saubere Antwort", () => {
    const r = scanResultFromJson({
      date: "2026-11-07", merchant: "Metro", totalGross: 101.84, vatRate: 7, vatAmount: 8.04,
      category: "Wareneinkauf (Lebensmittel)", description: "Hähnchen, Reis, Öl", paymentMethod: "CASH",
    });
    expect(r).toMatchObject({
      date: "2026-11-07", merchant: "Metro", amountCents: 10184, vatRate: 700, vatAmountCents: 804,
      category: "WAREN", customCategory: null, payment: "CASH", source: "gemini",
    });
  });

  it("rundet Beträge exakt in Cent (keine Gleitkomma-Fehler)", () => {
    expect(scanResultFromJson({ totalGross: 19.99 }).amountCents).toBe(1999);
    expect(scanResultFromJson({ totalGross: 0.29 }).amountCents).toBe(29);
    expect(scanResultFromJson({ totalGross: 1234.5 }).amountCents).toBe(123450);
  });

  it("akzeptiert Beträge als deutschen Text", () => {
    expect(scanResultFromJson({ totalGross: "1.234,56" }).amountCents).toBe(123456);
    expect(scanResultFromJson({ totalGross: "12,50" }).amountCents).toBe(1250);
  });

  it("verwirft unplausible Beträge und Daten statt zu raten", () => {
    const r = scanResultFromJson({ totalGross: -5, date: "2026-02-31", vatRate: 16, vatAmount: 0 });
    expect(r.amountCents).toBeNull();
    expect(r.date).toBeNull();
    expect(r.vatRate).toBeNull();
    expect(r.vatAmountCents).toBeNull();
    expect(scanResultFromJson({ totalGross: 0 }).amountCents).toBeNull();
    expect(scanResultFromJson({ totalGross: "abc" }).amountCents).toBeNull();
    expect(scanResultFromJson({ date: "07.11.2026" }).date).toBeNull();
  });

  it("MwSt-Betrag größer als Brutto wird ignoriert", () => {
    expect(scanResultFromJson({ totalGross: 10, vatAmount: 12 }).vatAmountCents).toBeNull();
  });

  it("ordnet Kategorien den festen Kategorien zu; Treibstoff wird eigene Kategorie", () => {
    expect(scanResultFromJson({ category: "Getränke" }).category).toBe("GETRAENKE");
    expect(scanResultFromJson({ category: "Betriebsbedarf" }).category).toBe("AUSSTATTUNG");
    const fuel = scanResultFromJson({ category: "Treibstoff", merchant: "Shell" });
    expect(fuel.customCategory).toBe("Treibstoff");
    expect(fuel.category).toBeNull();
  });

  it("'Sonstiges' lässt die Händler-Heuristik greifen", () => {
    expect(scanResultFromJson({ category: "Sonstiges", merchant: "Metro" }).category).toBe("WAREN");
    expect(scanResultFromJson({ category: "Sonstiges", merchant: "Irgendwer" }).category).toBe("SONSTIGES");
  });

  it("kommt mit Müll und leeren Antworten klar", () => {
    for (const bad of [null, undefined, "x", 5, [], {}]) {
      const r = scanResultFromJson(bad);
      expect(r.amountCents).toBeNull();
      expect(r.merchant).toBeNull();
      expect(r.payment).toBeNull();
    }
  });

  it("kürzt überlange Texte", () => {
    expect(scanResultFromJson({ merchant: "x".repeat(500) }).merchant).toHaveLength(60);
  });
});
