import { describe, expect, it } from "vitest";
import { centsToPlain, formatCents, parseEuroToCents, roundHalfAway } from "@/domain/money";
import { calcInvoice, calcLine, displayStatus, formatInvoiceNumber, quantityToMilli, vatBreakdown } from "@/domain/invoice";
import { deltasFor, reversalDeltas } from "@/domain/ledger";
import { dayRange, monthRange } from "@/domain/period";

describe("money", () => {
  it("parst deutsche und englische Eingaben", () => {
    expect(parseEuroToCents("1.234,56")).toBe(123456);
    expect(parseEuroToCents("1234,5")).toBe(123450);
    expect(parseEuroToCents("1234.56")).toBe(123456);
    expect(parseEuroToCents("12")).toBe(1200);
    expect(parseEuroToCents("15.000")).toBe(1500000); // Tausenderpunkt
    expect(parseEuroToCents("0,1")).toBe(10);
    expect(parseEuroToCents(0.1 + 0.2)).toBe(30);
  });
  it("lehnt Unsinn ab", () => {
    expect(() => parseEuroToCents("abc")).toThrow();
    expect(() => parseEuroToCents("1,234")).toThrow();
    expect(() => parseEuroToCents("")).toThrow();
  });
  it("formatiert", () => {
    expect(formatCents(123456).replace(/\s/g, " ")).toBe("1.234,56 €");
    expect(centsToPlain(-5)).toBe("-0,05");
  });
  it("rundet kaufmännisch", () => {
    expect(roundHalfAway(2.5)).toBe(3);
    expect(roundHalfAway(-2.5)).toBe(-3);
  });
});

describe("invoice", () => {
  it("rechnet Mengen ohne Float-Fehler", () => {
    expect(quantityToMilli("1,5")).toBe(1500);
    expect(calcLine({ description: "x", quantity: "1.5", unit: "kg", unitPriceCents: 333, vatRate: 700 }, 1).lineNetCents).toBe(500);
  });
  it("summiert je Steuersatz", () => {
    const r = calcInvoice([
      { description: "a", quantity: "2", unit: "Stk", unitPriceCents: 100000, vatRate: 1900 },
      { description: "b", quantity: "1.5", unit: "kg", unitPriceCents: 333, vatRate: 700 },
    ], false);
    expect(r).toMatchObject({ netCents: 200500, vatCents: 38035, grossCents: 238535 });
    expect(vatBreakdown(r.items)).toEqual([{ rate: 1900, net: 200000, vat: 38000 }, { rate: 700, net: 500, vat: 35 }]);
  });
  it("Kleinunternehmer: keine USt.", () => {
    const r = calcInvoice([{ description: "a", quantity: "1", unit: "Stk", unitPriceCents: 1000, vatRate: 1900 }], true);
    expect(r.vatCents).toBe(0);
  });
  it("Nummernformat und Überfälligkeit", () => {
    expect(formatInvoiceNumber("RE", 2026, 7)).toBe("RE-2026-0007");
    const now = new Date("2026-10-06T10:00:00Z");
    expect(displayStatus("OPEN", new Date("2026-10-05T10:00:00Z"), now)).toBe("OVERDUE");
    expect(displayStatus("OPEN", new Date("2026-10-06T10:00:00Z"), now)).toBe("OPEN");
    expect(displayStatus("PAID", new Date("2026-01-01"), now)).toBe("PAID");
  });
});

describe("ledger", () => {
  it("Vorzeichen je Buchungsart", () => {
    expect(deltasFor("ALLOCATION", 500)).toEqual({ poolDeltaCents: -500, walletDeltaCents: 500 });
    expect(deltasFor("RECEIPT", 500)).toEqual({ poolDeltaCents: 0, walletDeltaCents: -500 });
    expect(deltasFor("RETURN", 500)).toEqual({ poolDeltaCents: 500, walletDeltaCents: -500 });
    expect(reversalDeltas(deltasFor("ALLOCATION", 500))).toEqual({ poolDeltaCents: 500, walletDeltaCents: -500 });
  });
  it("nur positive Ganzzahlen", () => {
    expect(() => deltasFor("RECEIPT", 0)).toThrow();
    expect(() => deltasFor("RECEIPT", 1.5)).toThrow();
  });
});

describe("period (Europe/Berlin)", () => {
  it("Tagesgrenzen in deutscher Zeit (Sommerzeit)", () => {
    expect(dayRange("2026-10-06").start.toISOString()).toBe("2026-10-05T22:00:00.000Z");
  });
  it("Monat über Zeitumstellung", () => {
    const r = monthRange("2026-10");
    expect(r.start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });
});
