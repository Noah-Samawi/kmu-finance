import { describe, expect, it } from "vitest";
import { branchFigures } from "@/domain/branch";
import { PRIOR_REVERSAL, accountFlow, flowType, normalizeCategory } from "@/domain/cash";
import { rescaleDeltas } from "@/domain/ledger";
import { filterLedgerRows, kindOf } from "@/domain/ledger-filter";
import { detectPayment, parseReceiptText } from "@/domain/ocr";
import { autoPosting, matchBankLine, parseBankPdfText } from "@/domain/reconcile";

describe("Belegerkennung (OCR-Text)", () => {
  it("liest Lieferant, Betrag, Datum, Karte und Kategorie aus einem Metro-Bon", () => {
    const s = parseReceiptText(`
      METRO Deutschland GmbH
      Metro-Straße 1
      15.03.2026  14:22
      Zwischensumme  48,20
      MwSt 19 %       1,70
      SUMME EUR      49,90
      Kartenzahlung Visa
    `);
    expect(s).toMatchObject({ merchant: "Metro", amountCents: 4_990, date: "2026-03-15", payment: "CARD", category: "WAREN" });
  });

  it("erkennt Barzahlung und Lohn-Kategorie", () => {
    expect(detectPayment("BAR  gegeben 50,00  Rückgeld 5,10")).toBe("CASH");
    expect(parseReceiptText("Lohn Aushilfe Ali\nZu zahlen 1.200,00").category).toBe("LOHN");
  });
});

describe("Kontoauszug PDF-Text", () => {
  it("trennt Einnahmen und Ausgaben", () => {
    const lines = parseBankPdfText(`
      03.11.2026 03.11.2026 Kartenzahlung Lieferando 120,50-
      04.11.2026 04.11.2026 Gutschrift EC-Gerät +1.990,09
      05.11.2026 Geldautomat Wiesbaden -200,00
    `, "2026-11");
    expect(lines.map((l) => [l.bookingDate, l.amountCents])).toEqual([
      ["2026-11-03", -12_050],
      ["2026-11-04", 199_009],
      ["2026-11-05", -20_000],
    ]);
    expect(autoPosting(lines[0])).toMatchObject({ type: "EXPENSE" });
    expect(autoPosting(lines[1])).toMatchObject({ type: "INCOME_MANUAL", category: null });
    expect(matchBankLine(lines[2], [], []).status).toBe("CASH_WITHDRAWAL");
  });
});

describe("Storno früherer Buchungen zählt nicht als Tageseinnahme", () => {
  it("liegt das Original außerhalb, erscheint der Storno als eigene Zeile", () => {
    const inRange = new Set(["rev1"]);
    expect(flowType({ type: "REVERSAL", reversalOfId: "old", reversedType: "INCOME_MANUAL" }, inRange)).toBe(PRIOR_REVERSAL);
    const f = accountFlow("BANK", 0, [
      { type: PRIOR_REVERSAL, cashDeltaCents: 0, bankDeltaCents: -1_129_756 },
    ]);
    expect([f.dailyIncomeCents, f.expenseCents, f.priorReversalCents, f.closingCents]).toEqual([0, 0, -1_129_756, -1_129_756]);
  });

  it("liegt das Original im Zeitraum, wird die Einnahme netto ausgewiesen", () => {
    const inRange = new Set(["orig", "rev"]);
    expect(flowType({ type: "REVERSAL", reversalOfId: "orig", reversedType: "INCOME_MANUAL" }, inRange)).toBe("INCOME_MANUAL");
  });
});

describe("Ändern einer Buchung (Betrag skalieren)", () => {
  it("150 € Ausgabe Kasse → 130 €, Vorzeichen und Konto bleiben", () => {
    const d = rescaleDeltas({
      poolDeltaCents: -15_000, cashDeltaCents: -15_000, bankDeltaCents: 0, walletDeltaCents: 0,
      claimDeltaCents: 0, partnerDeltaCents: 0, accountKind: "CASH",
    }, 13_000);
    expect(d).toMatchObject({ cashDeltaCents: -13_000, poolDeltaCents: -13_000, bankDeltaCents: 0, accountKind: "CASH" });
  });
});

describe("Kategorien", () => {
  it("Lohn für Mitarbeiter und eigene Freitext-Kategorie", () => {
    expect(normalizeCategory("LOHN")).toBe("LOHN");
    expect(normalizeCategory("Lohn für Mitarbeiter")).toBe("LOHN");
    expect(normalizeCategory("Catering Event")).toBe("Catering Event");
    expect(() => normalizeCategory("x")).toThrow(/2 bis 40/);
  });
});

describe("Such- und Filterleiste", () => {
  const rows = [
    { type: "INCOME_MANUAL" as const, reversedType: null, description: "Tageseinnahme", employeeId: "ali", employeeName: "Ali",
      category: null, branchId: "ffm", branchName: "Frankfurt", accountKind: "CASH" as const,
      cashDeltaCents: 37_000, bankDeltaCents: 0, walletDeltaCents: 0, partnerDeltaCents: 0, poolDeltaCents: 37_000 },
    { type: "EXPENSE" as const, reversedType: null, description: "Metro Fleischeinkauf", employeeId: "jamil", employeeName: "Jamil",
      category: "WAREN", branchId: "ffm", branchName: "Frankfurt", accountKind: "CASH" as const,
      cashDeltaCents: -200_000, bankDeltaCents: 0, walletDeltaCents: 0, partnerDeltaCents: 0, poolDeltaCents: -200_000 },
  ];
  it("findet Person, Filiale, Kategorie und Betrag", () => {
    expect(filterLedgerRows(rows, { q: "ali frankfurt" })).toHaveLength(1);
    expect(filterLedgerRows(rows, { q: "metro" })[0].employeeName).toBe("Jamil");
    expect(filterLedgerRows(rows, { q: "2.000" })).toHaveLength(1);
    expect(filterLedgerRows(rows, { personId: "jamil", kind: "EXPENSE" })).toHaveLength(1);
    expect(kindOf(rows[0])).toBe("INCOME");
  });
});

describe("Filial-Auswertung", () => {
  it("Umsatz und Kosten getrennt nach Kasse und Bank", () => {
    const f = branchFigures([
      { type: "INCOME_MANUAL", cashDeltaCents: 37_000, bankDeltaCents: 0, poolDeltaCents: 37_000, walletDeltaCents: 0, partnerDeltaCents: 0, category: null },
      { type: "INCOME_MANUAL", cashDeltaCents: 0, bankDeltaCents: 38_340, poolDeltaCents: 38_340, walletDeltaCents: 0, partnerDeltaCents: 0, category: null },
      { type: "EXPENSE", cashDeltaCents: -15_000, bankDeltaCents: 0, poolDeltaCents: -15_000, walletDeltaCents: 0, partnerDeltaCents: 0, category: "WAREN" },
    ]);
    expect([f.revenueCashCents, f.revenueBankCents, f.costsCashCents, f.costsBankCents, f.resultCents])
      .toEqual([37_000, 38_340, 15_000, 0, 37_000 + 38_340 - 15_000]);
  });
});
