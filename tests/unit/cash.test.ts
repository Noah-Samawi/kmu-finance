import { describe, expect, it } from "vitest";
import {
  accountFlow, accountFlowLines, categoryLabel, correctionDiff, correctionText, dailyIncomeParts,
  duplicateWarning, duplicateWarnings, entryLabel, expenseDeltas,
} from "@/domain/cash";
import { deltasFor, DIRECTLY_REVERSIBLE } from "@/domain/ledger";
import { allowedSources, partnerPosting } from "@/domain/partner";
import { buildPersonReport, type PersonLedgerRow } from "@/domain/person-report";
import { balanceCorrectionSchema, dailyIncomeSchema, expenseSchema, partnerBookSchema } from "@/lib/validation/schemas";

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 10));
let n = 0;
function row(type: PersonLedgerRow["type"], d: Partial<PersonLedgerRow>, date = 10): PersonLedgerRow {
  return {
    id: `c${++n}`, type, reversedType: null, reversalOfId: null, bookingDate: day(date),
    cashDeltaCents: 0, bankDeltaCents: 0, walletDeltaCents: 0, claimDeltaCents: 0, partnerDeltaCents: 0,
    accountKind: null, description: "", ...d,
  };
}

describe("Kasse & Bank – Tageseinnahme", () => {
  it("Kasse und Bank werden gemeinsam erfasst", () => {
    expect(dailyIncomeParts(85_000, 120_000)).toEqual([
      { account: "CASH", amountCents: 85_000 }, { account: "BANK", amountCents: 120_000 },
    ]);
    expect(dailyIncomeParts(null, 5_000)).toEqual([{ account: "BANK", amountCents: 5_000 }]);
  });

  it("ohne Betrag oder mit negativem Betrag abgelehnt", () => {
    expect(() => dailyIncomeParts(null, null)).toThrow(/Kasse \(Bar\) und\/oder Bankkonto/);
    expect(() => dailyIncomeParts(0, 0)).toThrow();
    expect(() => dailyIncomeParts(-100, 0)).toThrow(/positiv/);
  });

  it("Dubletten-Hinweis je Konto mit Datum", () => {
    const d = new Date("2026-10-18T10:00:00Z");
    expect(duplicateWarning("CASH", d, 0)).toBeNull();
    expect(duplicateWarning("CASH", d, 1)).toBe("Achtung: Für das Datum 18.10.2026 wurden bereits Kassen-Einnahmen erfasst!");
    expect(duplicateWarning("BANK", d, 2)).toBe("Achtung: Für das Datum 18.10.2026 wurden bereits Bank-Einnahmen erfasst!");
  });

  it("1× Kasse + 1× Bank am selben Tag: NIE eine Warnung", () => {
    const d = new Date("2026-10-18T10:00:00Z");
    // erste Erfassung beider Konten
    expect(duplicateWarnings(d, { CASH: 0, BANK: 0 }, { cash: true, bank: true })).toEqual([]);
    // Kasse schon gebucht, jetzt nur Bank nachgetragen
    expect(duplicateWarnings(d, { CASH: 1, BANK: 0 }, { cash: false, bank: true })).toEqual([]);
    // Bank schon gebucht, jetzt nur Kasse
    expect(duplicateWarnings(d, { CASH: 0, BANK: 1 }, { cash: true, bank: false })).toEqual([]);
  });

  it("2× Kasse oder 2× Bank: Warnung nur für das betroffene Konto", () => {
    const d = new Date("2026-10-18T10:00:00Z");
    expect(duplicateWarnings(d, { CASH: 1, BANK: 1 }, { cash: true, bank: false }))
      .toEqual(["Achtung: Für das Datum 18.10.2026 wurden bereits Kassen-Einnahmen erfasst!"]);
    expect(duplicateWarnings(d, { CASH: 1, BANK: 1 }, { cash: false, bank: true }))
      .toEqual(["Achtung: Für das Datum 18.10.2026 wurden bereits Bank-Einnahmen erfasst!"]);
    expect(duplicateWarnings(d, { CASH: 1, BANK: 0 }, { cash: true, bank: true }))
      .toEqual(["Achtung: Für das Datum 18.10.2026 wurden bereits Kassen-Einnahmen erfasst!"]);
  });

  it("Schema: leere Felder sind kein Betrag, Euro-Eingabe wird zu Cent", () => {
    const v = dailyIncomeSchema.parse({ bookingDate: "2026-10-17", cashCents: "850,50", bankCents: "", description: "Tageseinnahme" });
    expect(v).toMatchObject({ cashCents: 85_050, bankCents: null, personId: null });
    expect(() => dailyIncomeSchema.parse({ bookingDate: "2026-10-17", cashCents: "-5", description: "x1" })).toThrow();
  });
});

describe("Kasse & Bank – Bestandskorrektur zum Stichtag", () => {
  it("bucht nur die Differenz zwischen Buch- und Ist-Bestand", () => {
    expect(correctionDiff(69_660, 65_000)).toBe(-4_660);
    expect(correctionDiff(10_000, 12_500)).toBe(2_500);
    expect(() => correctionDiff(10_000, 10_000)).toThrow(/keine Korrektur nötig/);
    expect(() => correctionDiff(10_000, -1)).toThrow();
  });

  it("Protokolltext enthält Stichtag, Buchbestand, Ist und Differenz", () => {
    const t = correctionText("CASH", new Date("2026-10-15T21:59:59Z"), 69_660, 65_000, "Kassensturz Abend");
    expect(t).toMatch(/^Bestandskorrektur Kasse \(Bar\) zum 15\.10\.2026 · Buchbestand 696,60\s€ → Ist 650,00\s€ \(Differenz -46,60\s€\) · Kassensturz Abend$/);
  });

  it("Begründung ist Pflicht (mind. 10 Zeichen)", () => {
    expect(() => balanceCorrectionSchema.parse({ accountKind: "CASH", date: "2026-10-15", actualCents: "650,00", description: "kurz" })).toThrow(/Begründung/);
    expect(balanceCorrectionSchema.parse({ accountKind: "BANK", date: "2026-10-15", actualCents: "0", description: "Kontoauszug geprüft" }).actualCents).toBe(0);
  });
});

describe("Betriebsausgaben (Gastro)", () => {
  it("Herkunft Kasse/Bank mindert das Firmenkonto, Budget/Kapital das Personenkonto", () => {
    expect(expenseDeltas("CASH", 4_990)).toMatchObject({ cashDeltaCents: -4_990, bankDeltaCents: 0, poolDeltaCents: -4_990, accountKind: "CASH" });
    expect(expenseDeltas("BANK", 4_990)).toMatchObject({ cashDeltaCents: 0, bankDeltaCents: -4_990, poolDeltaCents: -4_990 });
    expect(expenseDeltas("BUDGET", 4_990)).toMatchObject({ walletDeltaCents: -4_990, poolDeltaCents: 0, cashDeltaCents: 0 });
    expect(expenseDeltas("CAPITAL", 4_990)).toMatchObject({ partnerDeltaCents: -4_990, poolDeltaCents: 0 });
    expect(deltasFor("EXPENSE", 100, "BANK").bankDeltaCents).toBe(-100);
    expect(DIRECTLY_REVERSIBLE).toContain("EXPENSE");
  });

  it("Kategorie ist Pflicht und wird lesbar ausgegeben", () => {
    expect(() => expenseSchema.parse({ fund: "CASH", amountCents: "10", purpose: "Metro" })).toThrow(/Kategorie/);
    expect(expenseSchema.parse({ fund: "CASH", category: "WAREN", amountCents: "49,90", purpose: "Metro" }).amountCents).toBe(4_990);
    expect(categoryLabel("GETRAENKE")).toBe("Getränke");
    expect(categoryLabel(null)).toBe("Ohne Kategorie");
  });
});

describe("Gesellschafter: Einkauf für die Firma", () => {
  it("vom Kapitalkonto bzw. Budget – als Betriebsausgabe, ohne Kassenabgang", () => {
    const cap = partnerPosting("PURCHASE_CAPITAL", null, 200_000);
    expect(cap.type).toBe("EXPENSE");
    expect(cap.deltas).toMatchObject({ partnerDeltaCents: -200_000, cashDeltaCents: 0, bankDeltaCents: 0, walletDeltaCents: 0, claimDeltaCents: 0 });
    const bud = partnerPosting("PURCHASE_BUDGET", null, 200_000);
    expect(bud.deltas).toMatchObject({ walletDeltaCents: -200_000, partnerDeltaCents: 0 });
    expect(allowedSources("PURCHASE_CAPITAL")).toBeNull();
    expect(partnerBookSchema.parse({ kind: "PURCHASE_CAPITAL", amountCents: "2000", purpose: "Metro Fleischeinkauf", category: "WAREN" }).category).toBe("WAREN");
  });

  it("Beispiel: 6.000 € Kapital − 2.000 € Metro = 4.000 € Restguthaben, im Einzelbericht ausgewiesen", () => {
    const r = buildPersonReport({
      person: { id: "j", name: "Jamil", role: "PARTNER" }, from: "2026-10-01", to: "2026-10-31",
      opening: { walletCents: 0, claimCents: 0, capitalCents: 0 },
      rows: [
        row("PARTNER_DEPOSIT", { bankDeltaCents: 600_000, partnerDeltaCents: 600_000, accountKind: "BANK", description: "Einlage" }, 5),
        row("EXPENSE", { partnerDeltaCents: -200_000, description: "Wareneinkauf · Metro Fleischeinkauf" }, 9),
      ],
    });
    const cap = r.accounts.find((a) => a.key === "CAPITAL")!;
    expect([cap.openingCents, cap.inCents, cap.outCents, cap.closingCents]).toEqual([0, 600_000, 200_000, 400_000]);
    expect(cap.lines.find((l) => l.label.includes("Einkäufe"))?.cents).toBe(-200_000);
    expect(r.statements.join(" ")).toMatch(/Restguthaben Kapitalkonto Jamil: 4\.000,00\s€ – davon 2\.000,00\s€ für Einkäufe der Firma verrechnet/);
    expect(r.accounts.find((a) => a.key === "OUTLAY")!.closingCents).toBe(0);
  });

  it("Budget-Einkauf, zugeordnete Einnahme und Kassen-Ausgabe im Einzelbericht des Mitarbeiters", () => {
    const r = buildPersonReport({
      person: { id: "a", name: "Ali", role: "EMPLOYEE" }, from: "2026-10-01", to: "2026-10-31",
      opening: { walletCents: 50_000, claimCents: 0, capitalCents: 0 },
      rows: [
        row("EXPENSE", { walletDeltaCents: -20_000, description: "Getränke" }, 11),
        row("INCOME_MANUAL", { cashDeltaCents: 85_000, accountKind: "CASH", description: "Tageseinnahme · über Ali" }, 12),
        row("EXPENSE", { bankDeltaCents: -4_990, accountKind: "BANK", description: "Reinigung · durch Ali" }, 13),
      ],
    });
    const b = r.accounts.find((a) => a.key === "BUDGET")!;
    expect(b.closingCents).toBe(30_000);
    expect(b.lines.find((l) => l.label === "− Einkäufe für die Firma (aus Budget)")?.cents).toBe(-20_000);
    expect(r.transfers.map((t) => [t.direction, t.kind, t.accountLabel, t.deltaCents])).toEqual([
      ["COMPANY_INCOME", "Tageseinnahme Kasse (Bar)", "Kasse (Bar)", 85_000],
      ["COMPANY_EXPENSE", "Ausgabe Bankkonto", "Bankkonto", -4_990],
    ]);
    const s = r.statements.join(" ");
    expect(s).toMatch(/Restguthaben 300,00\s€ verbleibt bei Ali/);
    expect(s).toMatch(/Über Ali vereinnahmt: Kasse \(Bar\) 850,00\s€ – jeweils direkt/);
    expect(s).toMatch(/Von Ali für die Firma ausgegeben \(Firmenmittel\): Bankkonto 49,90\s€\./);
  });
});

describe("Strikte Trennung Kasse (Bar) / Bankkonto", () => {
  const rows = [
    { type: "INCOME_MANUAL", cashDeltaCents: 85_050, bankDeltaCents: 0 },
    { type: "INCOME_MANUAL", cashDeltaCents: 0, bankDeltaCents: 120_000 },
    { type: "INCOME_INVOICE", cashDeltaCents: 0, bankDeltaCents: 50_000 },
    { type: "EXPENSE", cashDeltaCents: -4_990, bankDeltaCents: 0 },
    { type: "EXPENSE", cashDeltaCents: 0, bankDeltaCents: -30_000 },
    { type: "ALLOCATION", cashDeltaCents: -10_000, bankDeltaCents: 0 },
    { type: "RETURN", cashDeltaCents: 2_000, bankDeltaCents: 0 },
    { type: "CASH_WITHDRAWAL", cashDeltaCents: 20_000, bankDeltaCents: -20_000 },
    { type: "ACCOUNT_ADJUST", cashDeltaCents: -1_000, bankDeltaCents: 0 },
    { type: "PARTNER_DEPOSIT", cashDeltaCents: 0, bankDeltaCents: 600_000 },
  ];

  it("Kasse enthält nur Kassenbewegungen – Einnahmen erhöhen, Ausgaben mindern", () => {
    expect(accountFlow("CASH", 10_000, rows)).toEqual({
      openingCents: 10_000, dailyIncomeCents: 85_050, invoiceIncomeCents: 0, expenseCents: 4_990,
      allocatedCents: 10_000, returnedCents: 2_000, transferCents: 20_000, correctionCents: -1_000, otherCents: 0,
      closingCents: 10_000 + 85_050 - 4_990 - 10_000 + 2_000 + 20_000 - 1_000,
    });
  });

  it("Bank enthält nur Bankbewegungen – nie mit der Kasse zusammengerechnet", () => {
    expect(accountFlow("BANK", 0, rows)).toEqual({
      openingCents: 0, dailyIncomeCents: 120_000, invoiceIncomeCents: 50_000, expenseCents: 30_000,
      allocatedCents: 0, returnedCents: 0, transferCents: -20_000, correctionCents: 0, otherCents: 600_000,
      closingCents: 120_000 + 50_000 - 30_000 - 20_000 + 600_000,
    });
  });

  it("Einnahmen zählen nie als Ausgabe – auch nicht nach Storno einer Ausgabe", () => {
    const f = accountFlow("CASH", 0, [
      { type: "INCOME_MANUAL", cashDeltaCents: 5_000, bankDeltaCents: 0 },
      { type: "EXPENSE", cashDeltaCents: -1_000, bankDeltaCents: 0 },
      { type: "EXPENSE", cashDeltaCents: 1_000, bankDeltaCents: 0 }, // Storno der Ausgabe
    ]);
    expect([f.dailyIncomeCents, f.expenseCents, f.closingCents]).toEqual([5_000, 0, 5_000]);
  });

  it("Berichtszeilen tragen den Kontonamen und gehen exakt auf", () => {
    const f = accountFlow("BANK", 0, rows);
    const lines = accountFlowLines("BANK", f);
    expect(lines.map((l) => l.label)).toEqual([
      "Anfangsbestand (Übertrag)", "+ Tageseinnahmen Bankkonto", "+ Zahlungseingänge aus Rechnungen",
      "− Ausgaben Bankkonto", "− Budget an Personen", "+ Rückgaben von Personen",
      "± Umbuchung in die Kasse (Abhebung)", "± Gesellschafter & Erstattungen", "= Endbestand Bankkonto",
    ]);
    const signed = lines.slice(0, -1).reduce((s, l) => s + (l.label.startsWith("−") ? -l.cents : l.cents), 0);
    expect(signed).toBe(lines.at(-1)!.cents);
  });

  it("Buchungstexte nennen das Konto", () => {
    expect(entryLabel("INCOME_MANUAL", "Einnahme (manuell)", { accountKind: "CASH" })).toBe("Tageseinnahme Kasse (Bar)");
    expect(entryLabel("INCOME_MANUAL", "Einnahme (manuell)", { accountKind: "BANK" })).toBe("Tageseinnahme Bankkonto");
    expect(entryLabel("EXPENSE", "Betriebsausgabe", { accountKind: "CASH" })).toBe("Ausgabe Kasse (Bar)");
    expect(entryLabel("EXPENSE", "Betriebsausgabe", { accountKind: "BANK" })).toBe("Ausgabe Bankkonto");
    expect(entryLabel("EXPENSE", "Betriebsausgabe", { accountKind: null, partnerDeltaCents: -1 })).toBe("Einkauf vom Kapitalkonto");
  });

  it("Tageseinnahme Kasse + Bank ergibt zwei getrennte Einnahmebuchungen", () => {
    const parts = dailyIncomeParts(85_050, 120_000);
    const d = parts.map((p) => deltasFor("INCOME_MANUAL", p.amountCents, p.account));
    expect(d.map((x) => [x.accountKind, x.cashDeltaCents, x.bankDeltaCents])).toEqual([["CASH", 85_050, 0], ["BANK", 0, 120_000]]);
  });
});
