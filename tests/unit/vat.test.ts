import { describe, expect, it } from "vitest";
import { calcInvoice, vatBreakdown, type LineInput } from "@/domain/invoice";
import { invoiceDraftSchema } from "@/lib/validation/schemas";

const line = (unitPriceCents: number, vatRate: number, quantity = "1"): LineInput => ({
  description: "Position", quantity, unit: "Stk", unitPriceCents, vatRate,
});

describe("USt.-Auswahl im Rechnungsformular", () => {
  it("übernimmt den gewählten Satz aus dem Dropdown (Basispunkte als String) statt 0 %", () => {
    const parsed = invoiceDraftSchema.parse({
      contactId: "c1",
      items: [
        { description: "Speisen", quantity: "1", unit: "Stk", unitPriceCents: "100,00", vatRate: "1900" },
        { description: "Service", quantity: "1", unit: "Stk", unitPriceCents: "100,00", vatRate: 2000 },
        { description: "Getränke", quantity: "1", unit: "Stk", unitPriceCents: "100,00", vatRate: "7" },
      ],
    });
    expect(parsed.items.map((i) => i.vatRate)).toEqual([1900, 2000, 700]);
  });

  it("lehnt Sätze über 20 % ab", () => {
    const r = invoiceDraftSchema.safeParse({
      contactId: "c1", items: [{ description: "x", quantity: "1", unit: "Stk", unitPriceCents: "1,00", vatRate: "2100" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("Steuerberechnung Netto × Satz = MwSt.", () => {
  it("19 %: 460,00 € netto → 87,40 € MwSt. → 547,40 € brutto", () => {
    const c = calcInvoice([line(1800, 1900, "20"), line(500, 1900, "20")], false);
    expect([c.netCents, c.vatCents, c.grossCents]).toEqual([46000, 8740, 54740]);
  });

  it("20 %: 1.000,00 € netto → 200,00 € MwSt.", () => {
    const c = calcInvoice([line(100000, 2000)], false);
    expect([c.netCents, c.vatCents, c.grossCents]).toEqual([100000, 20000, 120000]);
  });

  it("rechnet je Satz auf die Netto-Summe (keine Rundungsdifferenz aus Einzelpositionen)", () => {
    // 0,09 € × 19 % = 0,0171 € → 0,02 €; einzeln gerundet wären es 3 × 0,01 € = 0,03 €
    const c = calcInvoice([line(3, 1900), line(3, 1900), line(3, 1900)], false);
    expect(c.netCents).toBe(9);
    expect(c.vatCents).toBe(2);
    expect(c.items.reduce((s, i) => s + i.lineVatCents, 0)).toBe(c.vatCents);
  });

  it("weist gemischte Sätze getrennt aus", () => {
    const c = calcInvoice([line(10000, 1900), line(5000, 700), line(2000, 0), line(1000, 2000)], false);
    expect(vatBreakdown(c.items)).toEqual([
      { rate: 2000, net: 1000, vat: 200 },
      { rate: 1900, net: 10000, vat: 1900 },
      { rate: 700, net: 5000, vat: 350 },
      { rate: 0, net: 2000, vat: 0 },
    ]);
    expect(c.grossCents).toBe(18000 + 2450);
  });

  it("Kleinunternehmer (§ 19 UStG) setzt alle Sätze auf 0 %", () => {
    const c = calcInvoice([line(10000, 1900)], true);
    expect(c.vatCents).toBe(0);
    expect(c.items[0].vatRate).toBe(0);
  });
});
