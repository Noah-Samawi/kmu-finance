import { writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { buildPersonReport, type PersonLedgerRow } from "@/domain/person-report";
import { deltasFor, type LedgerType } from "@/domain/ledger";
import { partnerPosting } from "@/domain/partner";
import { calculatePayslip } from "@/domain/payroll";
import { PdfWriter } from "@/infrastructure/pdf/pdf-kit";
import { renderPayslipPdf } from "@/infrastructure/pdf/payslip-pdf";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/db/tenant-tx", () => ({ withTenant: vi.fn(), lockTenantLedger: vi.fn() }));
vi.mock("@/infrastructure/db/client", () => ({ db: {} }));

let n = 0;
const day = (d: number) => new Date(Date.UTC(2026, 9, d, 10));
function row(type: Exclude<LedgerType, "REVERSAL">, amount: number, account: "CASH" | "BANK" | null, d: number, description: string, over: Partial<PersonLedgerRow> = {}): PersonLedgerRow {
  const x = deltasFor(type, amount, account ?? "CASH");
  return {
    id: `r${++n}`, type, reversedType: null, reversalOfId: null, bookingDate: day(d),
    cashDeltaCents: x.cashDeltaCents, bankDeltaCents: x.bankDeltaCents, walletDeltaCents: x.walletDeltaCents,
    claimDeltaCents: x.claimDeltaCents, partnerDeltaCents: x.partnerDeltaCents,
    accountKind: account ? x.accountKind ?? null : null, description, ...over,
  };
}
const opening = { walletCents: 0, claimCents: 0, capitalCents: 0 };
const acc = (r: ReturnType<typeof buildPersonReport>, key: string) => r.accounts.find((a) => a.key === key)!;

describe("Einzelbericht je Person", () => {
  it("Mitarbeiter mit Restguthaben 2.000 € – verbleibt beim Mitarbeiter", () => {
    const r = buildPersonReport({
      person: { id: "ali", name: "Ali", role: "EMPLOYEE" }, from: "2026-10-01", to: "2026-10-31", opening,
      rows: [
        row("ALLOCATION", 300_000, "CASH", 11, "Mitro Einkäufe · aus Kasse (Bar)"),
        row("RECEIPT", 100_000, null, 12, "Metro – Küchenregale"),
      ],
    });
    const b = acc(r, "BUDGET");
    expect([b.openingCents, b.inCents, b.outCents, b.closingCents]).toEqual([0, 300_000, 100_000, 200_000]);
    expect(b.lines.find((l) => l.label.includes("Erhalten"))?.label).toContain("Kasse (Bar)");
    expect(r.statements[0]).toMatch(/Restguthaben 2\.000,00\s€ verbleibt bei Ali – nicht an die Firma zurücküberwiesen/);
    expect(r.transfers).toHaveLength(1);
    expect(r.transfers[0]).toMatchObject({ directionLabel: "Firma → Ali", accountLabel: "Kasse (Bar)", amountCents: 300_000, purpose: "Mitro Einkäufe · aus Kasse (Bar)" });
    expect(r.accounts.map((a) => a.key)).toEqual(["BUDGET", "OUTLAY"]);
  });

  it("Rückgabe an die Firma wird mit Datum und Konto ausgewiesen", () => {
    const r = buildPersonReport({
      person: { id: "ali", name: "Ali", role: "EMPLOYEE" }, from: "2026-10-01", to: "2026-10-31", opening: { ...opening, walletCents: 50_000 },
      rows: [
        row("ALLOCATION", 200_000, "BANK", 11, "Wareneinkauf"),
        row("RETURN", 250_000, "CASH", 13, "Bargeld zurück"),
      ],
    });
    const b = acc(r, "BUDGET");
    expect(b.openingCents).toBe(50_000);
    expect(b.closingCents).toBe(0);
    expect(r.statements.join(" ")).toMatch(/2\.500,00\s€ am 13\.10\.2026 an die Firma zurückgegeben \(Kasse \(Bar\)\)/);
    expect(r.transfers.map((t) => [t.directionLabel, t.accountLabel])).toEqual([["Firma → Ali", "Bankkonto"], ["Ali → Firma", "Kasse (Bar)"]]);
    expect(r.movements.map((m) => m.balanceAfterCents)).toEqual([250_000, 0]);
  });

  it("Gesellschafter: private Auslage landet auf dem Auslagenkonto, Kapital bleibt unberührt", () => {
    const outlay = partnerPosting("OUTLAY", "PRIVATE", 100_000).deltas;
    const r = buildPersonReport({
      person: { id: "jamiel", name: "Jamiel", role: "PARTNER" }, from: "2026-10-01", to: "2026-10-31", opening,
      rows: [
        { ...row("PARTNER_DEPOSIT", 200_000, "BANK", 10, "Einlage · Bankkonto der Firma") },
        {
          id: "o1", type: "PARTNER_OUTLAY", reversedType: null, reversalOfId: null, bookingDate: day(9),
          cashDeltaCents: 0, bankDeltaCents: 0, walletDeltaCents: 0, claimDeltaCents: outlay.claimDeltaCents, partnerDeltaCents: 0,
          accountKind: null, description: "مشتريات اثاث",
        },
      ],
    });
    expect(acc(r, "CAPITAL").closingCents).toBe(200_000);
    const o = acc(r, "OUTLAY");
    expect(o.closingCents).toBe(100_000);
    expect(o.firmViewCents).toBe(-100_000);
    expect(o.firmViewLabel).toBe("Verbindlichkeit der Firma");
    expect(r.statements.join(" ")).toMatch(/Die Firma schuldet Jamiel 1\.000,00\s€/);
  });

  it("Storno einer Einlage + Umbuchung als Auslage (Datenkorrektur) wirkt netto korrekt", () => {
    const dep: PersonLedgerRow = {
      id: "d1", type: "PARTNER_DEPOSIT", reversedType: null, reversalOfId: null, bookingDate: day(9),
      cashDeltaCents: 0, bankDeltaCents: 0, walletDeltaCents: 0, claimDeltaCents: 0, partnerDeltaCents: 100_000, accountKind: null, description: "Einlage · Eigene Tasche / Privat",
    };
    const rev: PersonLedgerRow = { ...dep, id: "d2", type: "REVERSAL", reversedType: "PARTNER_DEPOSIT", reversalOfId: "d1", partnerDeltaCents: -100_000, description: "Storno: Umbuchung" };
    const out: PersonLedgerRow = { ...dep, id: "d3", type: "PARTNER_OUTLAY", partnerDeltaCents: 0, claimDeltaCents: 100_000, description: "Auslage" };
    const r = buildPersonReport({ person: { id: "j", name: "Jamiel", role: "PARTNER" }, from: "2026-10-01", to: "2026-10-31", opening, rows: [dep, rev, out] });
    expect(acc(r, "CAPITAL").closingCents).toBe(0);
    expect(acc(r, "OUTLAY").closingCents).toBe(100_000);
    expect(r.movements.find((m) => m.id === "d1")?.reversed).toBe(true);
  });

  it("Einzelbericht als PDF (inkl. Arabisch)", async () => {
    const { drawPersonReport } = await import("@/application/reports/person-report");
    const base = buildPersonReport({
      person: { id: "othman", name: "Othman (عثمان)", role: "EMPLOYEE" }, from: "2026-10-01", to: "2026-10-31", opening,
      rows: [row("ALLOCATION", 100_000, "CASH", 11, "11.10 Kasse"), row("ADJUSTMENT", 20_000, null, 12, "اشترا فيها ادرات مطبخ")],
    });
    const w = await PdfWriter.create();
    drawPersonReport(w, { ...base, partnerBookings: [] });
    const pdf = await w.save();
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(1);
    if (process.env.PDF_PREVIEW_DIR) writeFileSync(path.join(process.env.PDF_PREVIEW_DIR, "einzelbericht.pdf"), pdf);
  });
});

describe("Lohnabrechnung ohne Kirchensteuer", () => {
  const input = (churchTax: "NONE" | "NINE") => ({ grossCents: 400_000, taxClass: 1, childAllowances: 0, churchTax, kvAdditionalBp: 250 });

  it("keine Konfession → 0 € Kirchensteuer", () => {
    expect(calculatePayslip(input("NONE")).churchTaxCents).toBe(0);
    expect(calculatePayslip(input("NINE")).churchTaxCents).toBeGreaterThan(0);
  });

  async function pdfTexts(churchTax: "NONE" | "NINE", ytdChurch = 0) {
    const calc = calculatePayslip(input(churchTax));
    const texts: string[] = [];
    const spy = vi.spyOn(PdfWriter.prototype, "drawAt").mockImplementation((_pg, t, x) => { texts.push(t); return x; });
    await renderPayslipPdf({
      ...calc, employer: { name: "Test GmbH" }, employeeName: "Anna", year: 2026, month: 10, taxClass: 1, churchTax, childAllowances: 0,
      ytd: { grossCents: 400_000, wageTaxCents: calc.wageTaxCents, churchTaxCents: ytdChurch || calc.churchTaxCents, soliCents: 0, kvCents: calc.kvCents, rvCents: calc.rvCents, avCents: calc.avCents, pvCents: calc.pvCents },
    } as Parameters<typeof renderPayslipPdf>[0]);
    spy.mockRestore();
    return texts;
  }

  it("PDF ohne Konfession enthält keine Kirchensteuer-Spalte oder -Zeile", async () => {
    const texts = await pdfTexts("NONE");
    expect(texts.some((t) => t.includes("Kirchensteuer"))).toBe(false);
    expect(texts).toContain("--");
  });

  it("PDF mit Konfession weist Kirchensteuer aus", async () => {
    const texts = await pdfTexts("NINE");
    expect(texts.filter((t) => t === "Kirchensteuer")).toHaveLength(2);
  });

  it("ausgestellte Abrechnung ohne Konfession zeigt nie Kirchensteuer", async () => {
    const { issuedValues } = await import("@/application/hr/hr");
    const calc = calculatePayslip(input("NONE"));
    const v = issuedValues(calc, {
      churchTax: "NONE", churchTaxCents: 3_000, grossCents: calc.grossCents, rvCents: calc.rvCents, avCents: calc.avCents,
      kvCents: calc.kvCents, pvCents: calc.pvCents, wageTaxCents: calc.wageTaxCents, soliCents: calc.soliCents, netCents: calc.netCents - 3_000,
    } as Parameters<typeof issuedValues>[1]);
    expect(v.churchTaxCents).toBe(0);
    expect(v.netCents).toBe(calc.netCents);
    expect(v.grossCents - v.taxDeductionCents - v.svDeductionCents).toBe(v.netCents);
  });
});
