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
    expect(deltasFor("ALLOCATION", 500)).toMatchObject({ poolDeltaCents: -500, walletDeltaCents: 500, cashDeltaCents: -500, bankDeltaCents: 0 });
    expect(deltasFor("ALLOCATION", 500, "BANK")).toMatchObject({ poolDeltaCents: -500, bankDeltaCents: -500, cashDeltaCents: 0, walletDeltaCents: 500 });
    expect(deltasFor("RECEIPT", 500)).toMatchObject({ poolDeltaCents: 0, walletDeltaCents: -500 });
    expect(deltasFor("RETURN", 500, "BANK")).toMatchObject({ poolDeltaCents: 500, bankDeltaCents: 500, walletDeltaCents: -500 });
    expect(deltasFor("CASH_WITHDRAWAL", 200)).toMatchObject({ cashDeltaCents: 200, bankDeltaCents: -200, poolDeltaCents: 0 });
    expect(reversalDeltas(deltasFor("ALLOCATION", 500))).toMatchObject({ poolDeltaCents: 500, walletDeltaCents: -500 });
    expect(deltasFor("EMPLOYEE_OUTLAY", 800)).toMatchObject({ claimDeltaCents: 800, poolDeltaCents: 0, walletDeltaCents: 0 });
    expect(deltasFor("OUTLAY_REPAY", 800, "BANK")).toMatchObject({ claimDeltaCents: -800, bankDeltaCents: -800, poolDeltaCents: -800 });
    expect(deltasFor("PARTNER_DEPOSIT", 1000, "BANK")).toMatchObject({ partnerDeltaCents: 1000, bankDeltaCents: 1000 });
  });
  it("nur positive Ganzzahlen", () => {
    expect(() => deltasFor("RECEIPT", 0)).toThrow();
    expect(() => deltasFor("RECEIPT", 1.5)).toThrow();
  });
});

describe("payroll & bank match", () => {
  it("berechnet Netto unter Brutto", async () => {
    const { calculatePayslip } = await import("@/domain/payroll");
    const r = calculatePayslip({ grossCents: 300000, taxClass: 1, childAllowances: 0, churchTax: "NONE", kvAdditionalBp: 250 });
    expect(r.netCents).toBeGreaterThan(0);
    expect(r.netCents).toBeLessThan(r.grossCents);
    expect(r.payoutCents).toBe(r.netCents);
    expect(r.employerCostCents).toBe(r.grossCents + r.employerSvCents);
    expect(r.taxDeductionCents).toBe(r.wageTaxCents + r.soliCents + r.churchTaxCents);
    const { monthlyGrossFromHours } = await import("@/domain/payroll");
    expect(monthlyGrossFromHours(160, 1500)).toBe(240000);
    expect(monthlyGrossFromHours(0, 1500)).toBe(0);
  });
  it("erkennt Geldautomaten und CSV", async () => {
    const { isCashWithdrawal, parseBankCsv, matchBankLine } = await import("@/domain/reconcile");
    expect(isCashWithdrawal("Auszahlung Geldautomat", "")).toBe(true);
    const csv = "Buchungstag;Betrag;Beguenstigter;Verwendungszweck\n10.10.2026;-50,00;Sparkasse;Geldautomat City";
    expect(parseBankCsv(csv)[0].amountCents).toBe(-5000);
    expect(matchBankLine(parseBankCsv(csv)[0], [], []).status).toBe("CASH_WITHDRAWAL");
  });
});

describe("receipt inline data-url", () => {
  it("rundtrip Base64-Data-URL", async () => {
    const { parseReceiptDataUrl, toReceiptDataUrl } = await import("@/application/receipts/inline-file");
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]);
    const url = toReceiptDataUrl("image/jpeg", buf);
    expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
    const parsed = parseReceiptDataUrl(url);
    expect(parsed?.mime).toBe("image/jpeg");
    expect(parsed?.data.equals(buf)).toBe(true);
    expect(parseReceiptDataUrl("tenant/receipts/x.jpg")).toBeNull();
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
