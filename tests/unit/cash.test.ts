import { describe, expect, it } from "vitest";
import {
  categoryLabel, correctionDiff, correctionText, dailyIncomeParts, duplicateWarning, expenseDeltas,
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

  it("Dubletten-Hinweis nur, wenn schon eine Einnahme existiert", () => {
    expect(duplicateWarning(0)).toBeNull();
    expect(duplicateWarning(1)).toBe("Achtung: Für dieses Datum existiert bereits eine Einnahmebuchung!");
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
    expect(r.transfers.map((t) => [t.direction, t.directionLabel, t.accountLabel, t.amountCents])).toEqual([
      ["COMPANY_INCOME", "Einnahme über Ali → Firmenkonto", "Kasse (Bar)", 85_000],
      ["COMPANY_EXPENSE", "Firmenmittel, ausgegeben von Ali", "Bankkonto", 4_990],
    ]);
    const s = r.statements.join(" ");
    expect(s).toMatch(/Restguthaben 300,00\s€ verbleibt bei Ali/);
    expect(s).toMatch(/Über Ali vereinnahmt: 850,00\s€/);
    expect(s).toMatch(/Ali hat 49,90\s€ Firmenmittel/);
  });
});
