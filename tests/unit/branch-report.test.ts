import { describe, expect, it } from "vitest";
import {
  UNASSIGNED_BRANCH_NAME, branchBalanceSnapshot, branchHeadline, branchPdfUrl, branchReportTitle, buildBranchReport,
  reportFileStem, reportPeriodLabel, reportScopeTitle,
} from "@/domain/branch";
import { zipStore } from "@/infrastructure/zip";
import type { LedgerType } from "@/domain/ledger";

function row(
  id: string, type: LedgerType, over: Partial<{
    cash: number; bank: number; pool: number; wallet: number; partner: number;
    reversedType: LedgerType | null; reversalOfId: string | null; category: string | null;
  }> = {},
) {
  return {
    id, type,
    reversedType: over.reversedType ?? null,
    reversalOfId: over.reversalOfId ?? null,
    cashDeltaCents: over.cash ?? 0,
    bankDeltaCents: over.bank ?? 0,
    poolDeltaCents: over.pool ?? (over.cash ?? 0) + (over.bank ?? 0),
    walletDeltaCents: over.wallet ?? 0,
    partnerDeltaCents: over.partner ?? 0,
    category: over.category ?? null,
  };
}

describe("Filial-autonome Bestände", () => {
  it("Frankfurt-Kasse mischt sich nicht mit Wiesbaden-Bank (Anfangsbestand + Periode + Endbestand)", () => {
    const frankfurt = [
      row("f1", "INCOME_MANUAL", { cash: 210_000 }),
      row("f2", "EXPENSE", { cash: -1_424_000, category: "WAREN" }),
    ];
    const wiesbaden = [
      row("w1", "INCOME_MANUAL", { bank: 363_482 }),
      row("w2", "REVERSAL", { bank: -1_129_756, reversedType: "INCOME_MANUAL", reversalOfId: "old-bank" }),
    ];
    const f = branchBalanceSnapshot("ffm", "Frankfurt", { cashCents: 1_473_500, bankCents: 0 }, frankfurt, new Set(["f1", "f2"]));
    expect(f.cashOpeningCents).toBe(1_473_500);
    expect(f.incomeCents).toBe(210_000);
    expect(f.expenseCents).toBe(1_424_000);
    expect(f.cashClosingCents).toBe(1_473_500 + 210_000 - 1_424_000);
    expect(f.bankOpeningCents).toBe(0);
    expect(f.bankClosingCents).toBe(0);
    expect(f.resultCents).toBe(210_000 - 1_424_000);

    const w = branchBalanceSnapshot("wi", "Wiesbaden", { cashCents: 0, bankCents: 3_030_836 }, wiesbaden, new Set(["w1", "w2"]));
    expect(w.cashClosingCents).toBe(0);
    expect(w.bankOpeningCents).toBe(3_030_836);
    expect(w.bankClosingCents).toBe(3_030_836 + 363_482 - 1_129_756);
    expect(w.incomeCents).toBe(363_482 - 1_129_756);

    const all = [...frankfurt, ...wiesbaden];
    const total = branchBalanceSnapshot("total", "Gesamt", { cashCents: 1_473_500, bankCents: 3_030_836 }, all, new Set(all.map((r) => r.id)));
    expect(total.cashClosingCents).toBe(f.cashClosingCents);
    expect(total.bankClosingCents).toBe(w.bankClosingCents);
    expect(total.incomeCents).toBe(f.incomeCents + w.incomeCents);
    expect(total.expenseCents).toBe(f.expenseCents);
  });

  it("Storno einer Buchung im Zeitraum mindert die Einnahmen netto, ohne die andere Filiale zu berühren", () => {
    const rows = [
      row("a", "INCOME_MANUAL", { cash: 100_000 }),
      row("b", "REVERSAL", { cash: -100_000, reversedType: "INCOME_MANUAL", reversalOfId: "a" }),
    ];
    const ids = new Set(["a", "b"]);
    const f = branchBalanceSnapshot("ffm", "Frankfurt", { cashCents: 50_000, bankCents: 0 }, rows, ids);
    expect(f.incomeCents).toBe(0);
    expect(f.cashClosingCents).toBe(50_000);
  });
});

describe("Berichtskopf", () => {
  it("Monatsbericht trägt den Filialnamen", () => {
    expect(reportPeriodLabel("2026-11-01", "2026-11-08").kind).toBe("month");
    expect(reportScopeTitle("2026-11-01", "2026-11-08", { branchName: "Frankfurt" }))
      .toBe("Monatsbericht November 2026 – Filiale Frankfurt");
    expect(reportScopeTitle("2026-11-01", "2026-11-30", { unassigned: true }))
      .toBe(`Monatsbericht November 2026 – ${UNASSIGNED_BRANCH_NAME}`);
    expect(reportScopeTitle("2026-11-01", "2026-11-08", {}))
      .toBe("Konsolidierter Monatsbericht – Alle Filialen");
  });

  it("Zeitraum über Monatsgrenzen wird als Bericht mit Datumsspanne betitelt", () => {
    expect(reportScopeTitle("2026-10-15", "2026-11-08", { branchName: "Wiesbaden" }))
      .toBe("Bericht 15.10.2026 – 08.11.2026 – Filiale Wiesbaden");
    expect(reportScopeTitle("2026-10-15", "2026-11-08", {}))
      .toBe("Konsolidierter Bericht – Alle Filialen");
  });

  it("Dateinamen und Briefkopf je Filiale", () => {
    expect(branchHeadline({ branchName: "Wiesbaden" })).toBe("Filiale: Wiesbaden");
    expect(branchHeadline({ unassigned: true })).toBe(`Filiale: ${UNASSIGNED_BRANCH_NAME}`);
    expect(branchHeadline({})).toBeNull();
    expect(reportFileStem("2026-11-01", "2026-11-08", { branch: "Frankfurt" }))
      .toBe("Monatsbericht_Frankfurt_2026-11-01_2026-11-08");
    expect(reportFileStem("2026-11-01", "2026-11-08", "zentral"))
      .toBe("Monatsbericht_Zentral_Ohne_Filiale_2026-11-01_2026-11-08");
    expect(reportFileStem("2026-11-01", "2026-11-08", "gesamt"))
      .toBe("Monatsbericht_Gesamt_2026-11-01_2026-11-08");
    expect(reportFileStem("2026-11-01", "2026-11-08", { branch: "Wiesbaden" }, "Filialbericht"))
      .toBe("Filialbericht_Wiesbaden_2026-11-01_2026-11-08");
    expect(branchPdfUrl("abc", "2026-11-01", "2026-11-08", "filialbericht"))
      .toBe("/api/v1/reports/branch/abc?from=2026-11-01&to=2026-11-08&stem=filialbericht");
  });

  it("Einzelbericht-Titel nennt die Filiale", () => {
    expect(branchReportTitle({ branchName: "Frankfurt" }))
      .toBe("Filialbericht & Monatsabschluss: Filiale Frankfurt");
    expect(branchReportTitle({ unassigned: true }))
      .toBe(`Filialbericht & Monatsabschluss: ${UNASSIGNED_BRANCH_NAME}`);
  });
});

describe("Einzelbericht je Filiale", () => {
  it("Frankfurt mischt keine Wiesbadener Zahlen in Kennzahlen und Endbestand", () => {
    const r = buildBranchReport({
      branch: { id: "ffm", name: "Frankfurt" },
      from: "2026-11-01", to: "2026-11-08",
      opening: { cashCents: 0, bankCents: 0 },
      rows: [
        row("f1", "INCOME_MANUAL", { cash: 200_000 }),
        row("f2", "INCOME_MANUAL", { bank: 200_000 }),
      ],
    });
    expect(r.figures.revenueCashCents).toBe(200_000);
    expect(r.figures.revenueBankCents).toBe(200_000);
    expect(r.figures.costsCents).toBe(0);
    expect(r.cash.closingCents).toBe(200_000);
    expect(r.bank.closingCents).toBe(200_000);
    expect(r.figures.resultCents).toBe(400_000);
    expect(r.branch.unassigned).toBe(false);
    const w = buildBranchReport({
      branch: { id: "none", name: UNASSIGNED_BRANCH_NAME, unassigned: true },
      from: "2026-11-01", to: "2026-11-08",
      opening: { cashCents: 50_000, bankCents: 0 },
      rows: [row("z1", "EXPENSE", { cash: -10_000, category: "MIETE" })],
    });
    expect(w.branch.unassigned).toBe(true);
    expect(w.figures.costsCents).toBe(10_000);
    expect(w.cash.closingCents).toBe(40_000);
    expect(w.figures.resultCents).toBe(-10_000);
    expect(w.figures.revenueCashCents).toBe(0);
  });
});

describe("ZIP der Filialberichte", () => {
  it("packt mehrere PDFs unter den Filialnamen", () => {
    const zip = zipStore([
      { name: "Monatsbericht_Frankfurt_2026-11-01_2026-11-08.pdf", data: Buffer.from("%PDF-FFM") },
      { name: "Monatsbericht_Wiesbaden_2026-11-01_2026-11-08.pdf", data: Buffer.from("%PDF-WI") },
      { name: "Monatsbericht_Zentral_Ohne_Filiale_2026-11-01_2026-11-08.pdf", data: Buffer.from("%PDF-Z") },
    ]);
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    const asText = zip.toString("binary");
    expect(asText).toContain("Monatsbericht_Frankfurt_2026-11-01_2026-11-08.pdf");
    expect(asText).toContain("Monatsbericht_Wiesbaden_2026-11-01_2026-11-08.pdf");
    expect(asText).toContain("Monatsbericht_Zentral_Ohne_Filiale_2026-11-01_2026-11-08.pdf");
  });
});
