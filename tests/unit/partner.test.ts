import { writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import {
  allowedSources, assertPurpose, isRefundable, partnerPosting, refundStatus, validateRefundAllocation,
  type FundingSource, type PartnerKind,
} from "@/domain/partner";
import type { Deltas } from "@/domain/ledger";
import { partnerSelfBookSchema } from "@/lib/validation/schemas";
import type { PartnerBookingRow } from "@/application/partners/partner-bookings";
import type { Summary } from "@/application/reports/reports";
import { accountFlow } from "@/domain/cash";

vi.mock("server-only", () => ({}));
vi.mock("@/infrastructure/db/tenant-tx", () => ({ withTenant: vi.fn(), lockTenantLedger: vi.fn() }));
vi.mock("@/infrastructure/db/client", () => ({ db: {} }));

/** Summiert die Konten eines Gesellschafters wie das Hauptbuch (SUM der Deltas) */
function accounts(postings: { kind: PartnerKind; source: FundingSource | null; amount: number }[]) {
  const sum = { capital: 0, outlay: 0, budget: 0, cash: 0, bank: 0 };
  for (const p of postings) {
    const d: Deltas = partnerPosting(p.kind, p.source, p.amount).deltas;
    sum.capital += d.partnerDeltaCents;
    sum.outlay += d.claimDeltaCents;
    sum.budget += d.walletDeltaCents;
    sum.cash += d.cashDeltaCents;
    sum.bank += d.bankDeltaCents;
  }
  return sum;
}

describe("Gesellschafter: Vorgelegtes Geld strikt getrennt", () => {
  it("1.000 € Auslage + 2.000 € Budget: die 1.000 € bleiben offen", () => {
    const s = accounts([
      { kind: "OUTLAY", source: "PRIVATE", amount: 100_000 },
      { kind: "BUDGET", source: "BANK", amount: 200_000 },
    ]);
    expect(s.outlay).toBe(100_000);
    expect(s.budget).toBe(200_000);
    expect(s.capital).toBe(0);
    expect(s.bank).toBe(-200_000);
  });

  it("weder Einnahmen, Einlagen noch Entnahmen berühren das Auslagenkonto", () => {
    const s = accounts([
      { kind: "OUTLAY", source: "PRIVATE", amount: 100_000 },
      { kind: "DEPOSIT", source: "BANK", amount: 50_000 },
      { kind: "DRAW", source: "CASH", amount: 20_000 },
      { kind: "PROFIT", source: null, amount: 30_000 },
      { kind: "BUDGET_RETURN", source: "CASH", amount: 10_000 },
    ]);
    expect(s.outlay).toBe(100_000);
    expect(s.capital).toBe(60_000);
  });

  it("erst die gezielte Erstattung senkt das Auslagenkonto", () => {
    const s = accounts([
      { kind: "OUTLAY", source: "PRIVATE", amount: 100_000 },
      { kind: "BUDGET", source: "BANK", amount: 200_000 },
      { kind: "OUTLAY_REFUND", source: "BANK", amount: 40_000 },
    ]);
    expect(s.outlay).toBe(60_000);
    expect(s.budget).toBe(200_000);
    expect(s.bank).toBe(-240_000);
  });

  it("Ausgabe mit Firmenkarte/Kasse mindert das Konto ohne Erstattungsanspruch", () => {
    const card = partnerPosting("OUTLAY", "BANK", 5_000);
    expect(card.type).toBe("PARTNER_EXPENSE");
    expect(card.deltas).toMatchObject({ bankDeltaCents: -5_000, cashDeltaCents: 0, claimDeltaCents: 0, accountKind: "BANK" });
    expect(isRefundable("OUTLAY", "BANK")).toBe(false);
    expect(isRefundable("OUTLAY", "CASH")).toBe(false);
    expect(isRefundable("OUTLAY", "PRIVATE")).toBe(true);
    const cash = partnerPosting("OUTLAY", "CASH", 2_500);
    expect(cash.deltas).toMatchObject({ cashDeltaCents: -2_500, bankDeltaCents: 0, poolDeltaCents: -2_500 });
  });

  it("Auslage aus eigener Tasche bewegt weder Kasse noch Bank", () => {
    const p = partnerPosting("OUTLAY", "PRIVATE", 100_000);
    expect(p.type).toBe("PARTNER_OUTLAY");
    expect(p.deltas).toMatchObject({ poolDeltaCents: 0, cashDeltaCents: 0, bankDeltaCents: 0, claimDeltaCents: 100_000 });
  });
});

describe("Mittelherkunft und Begründung", () => {
  it("privat ausgelegtes Geld erhöht nie das Kapitalkonto", () => {
    expect(() => partnerPosting("DEPOSIT", "PRIVATE", 100_000)).toThrow(/nie das Kapitalkonto/);
    expect(allowedSources("DEPOSIT")).toEqual(["BANK", "CASH"]);
    const p = partnerPosting("OUTLAY", "PRIVATE", 100_000).deltas;
    expect(p.partnerDeltaCents).toBe(0);
    expect(p.claimDeltaCents).toBe(100_000);
  });

  it("Mittelherkunft ist Pflicht und muss zum Vorgang passen", () => {
    expect(() => partnerPosting("OUTLAY", null, 1_000)).toThrow(/Mittelherkunft/);
    expect(() => partnerPosting("DRAW", "PRIVATE", 1_000)).toThrow(/nicht möglich/);
    expect(() => partnerPosting("OUTLAY_REFUND", "PRIVATE", 1_000)).toThrow(/nicht möglich/);
    expect(allowedSources("OUTLAY")).toEqual(["PRIVATE", "BANK", "CASH"]);
    expect(allowedSources("PROFIT")).toBeNull();
  });

  it("API-Schema verlangt Mittelherkunft und Vorgang", () => {
    const base = { kind: "OUTLAY", amountCents: "12,50", purpose: "Druckerpapier für Büro" };
    expect(partnerSelfBookSchema.safeParse(base).success).toBe(false);
    expect(partnerSelfBookSchema.safeParse({ ...base, source: "WALLET" }).success).toBe(false);
    const ok = partnerSelfBookSchema.parse({ ...base, source: "PRIVATE" });
    expect(ok.amountCents).toBe(1250);
    expect(partnerSelfBookSchema.safeParse({ ...base, kind: "PROFIT", source: "BANK" }).success).toBe(false);
  });

  it("ohne Beleg ist eine aussagekräftige Begründung Pflicht", () => {
    expect(() => assertPurpose("Taxi", false)).toThrow(/Ohne Beleg/);
    expect(() => assertPurpose("Taxi zum Kunden Müller", false)).not.toThrow();
    expect(() => assertPurpose("Taxi", true)).not.toThrow();
    expect(() => assertPurpose("  ", true)).toThrow();
  });
});

describe("Gezielte Auslagen-Erstattung", () => {
  const open = [{ id: "a", openCents: 100_000 }, { id: "b", openCents: 3_000 }];

  it("ordnet Teilbeträge einzelnen Auslagen zu", () => {
    expect(validateRefundAllocation(open, [{ outlayId: "a", amountCents: 40_000 }, { outlayId: "b", amountCents: 3_000 }])).toBe(43_000);
  });

  it("verhindert Überzahlung, fremde und doppelte Auslagen", () => {
    expect(() => validateRefundAllocation(open, [])).toThrow(/mindestens eine/);
    expect(() => validateRefundAllocation(open, [{ outlayId: "a", amountCents: 100_001 }])).toThrow(/übersteigt/);
    expect(() => validateRefundAllocation(open, [{ outlayId: "x", amountCents: 1 }])).toThrow(/nicht \(mehr\) offen/);
    expect(() => validateRefundAllocation(open, [{ outlayId: "b", amountCents: 1 }, { outlayId: "b", amountCents: 1 }])).toThrow(/doppelt/);
  });

  it("Status: offen → teilweise → erstattet", () => {
    expect(refundStatus(100_000, 0)).toBe("OPEN");
    expect(refundStatus(100_000, 40_000)).toBe("PARTIAL");
    expect(refundStatus(100_000, 100_000)).toBe("REFUNDED");
  });
});

describe("Bericht: Gesellschafter-Buchungen im PDF und CSV", () => {
  const d = new Date("2026-10-05T10:00:00Z");
  const row = (over: Partial<PartnerBookingRow>): PartnerBookingRow => ({
    id: "b1", partnerId: "p1", partnerName: "Samir Haddad", kind: "OUTLAY", source: "PRIVATE", amountCents: 100_000,
    purpose: "Ware beim Großhandel bezahlt", hasReceipt: false, bookingDate: d, createdByName: "Samir Haddad",
    selfEntered: true, ledgerEntryId: "l1", reversed: false, refundable: true, refundedCents: 40_000, openCents: 60_000,
    status: "PARTIAL", settles: [], ...over,
  });
  const bookings = [
    row({}),
    row({ id: "b2", kind: "BUDGET", source: "BANK", amountCents: 200_000, purpose: "Budget Oktober", refundable: false, refundedCents: 0, openCents: 0, status: null, selfEntered: false, createdByName: "Admin" }),
    row({ id: "b3", kind: "OUTLAY_REFUND", source: "BANK", amountCents: 40_000, purpose: "Auslagen-Erstattung", refundable: false, refundedCents: 0, openCents: 0, status: null, selfEntered: false, createdByName: "Admin", settles: [{ outlayId: "b1", amountCents: 40_000, purpose: "Ware beim Großhandel bezahlt", bookingDate: d }] }),
    row({ id: "b4", partnerName: "ليلى", kind: "OUTLAY", source: "BANK", amountCents: 4_990, purpose: "شراء لوازم مكتبية", hasReceipt: true, refundable: false, refundedCents: 0, openCents: 0, status: null }),
  ];

  it("Status-Text zeigt offen/erstattet und die getilgte Auslage", async () => {
    const { partnerStatusText: raw } = await import("@/application/reports/export");
    const partnerStatusText = (b: PartnerBookingRow) => raw(b).replace(/\u00a0/g, " ");
    expect(partnerStatusText(bookings[0])).toBe("teilweise erstattet, offen 600,00 €");
    expect(partnerStatusText(row({ refundedCents: 100_000, openCents: 0, status: "REFUNDED" }))).toBe("durch Admin erstattet");
    expect(partnerStatusText(bookings[2])).toContain("tilgt: 05.10.2026 Ware beim Großhandel bezahlt (400,00 €)");
    expect(partnerStatusText(bookings[3])).toBe("Firmenmittel – keine Erstattung");
    expect(partnerStatusText(row({ reversed: true }))).toBe("storniert");
  });

  it("CSV enthält Person, Herkunft, Betrag, Zweck und Status", async () => {
    const { toCsv } = await import("@/application/reports/export");
    const csv = toCsv([], bookings).replace(/\u00a0/g, " ");
    expect(csv).toContain("Samir Haddad;Auslage / Ausgabe für die Firma;Eigene Tasche / Privat;1000,00;Ware beim Großhandel bezahlt;nein;Samir Haddad;teilweise erstattet, offen 600,00 €");
    expect(csv).toContain("Bankkonto der Firma");
  });

  it("PDF rendert den Firmenbericht", async () => {
    const { renderReportPdf } = await import("@/application/reports/export");
    const s: Summary = {
      from: "2026-10-01", to: "2026-10-11",
      pool: { openingCents: 0, incomeInvoiceCents: 0, incomeManualCents: 0, allocatedCents: 200_000, returnedCents: 0, expenseCents: 4_990, otherCents: 0, closingCents: -204_990 },
      cash: accountFlow("CASH", 0, []),
      bank: accountFlow("BANK", 500_000, [
        { type: "ALLOCATION", cashDeltaCents: 0, bankDeltaCents: -200_000 },
        { type: "EXPENSE", cashDeltaCents: 0, bankDeltaCents: -4_990 },
        { type: "PARTNER_DRAW", cashDeltaCents: 0, bankDeltaCents: -35_010 },
      ]),
      carryForward: { cashCents: 0, bankCents: 500_000, poolCents: 0 },
      totals: { receiptsCents: 0, adjustmentsCents: 0, walletsOpenCents: 0, claimsOpenCents: 0, expensesCents: 4_990, expensesByCategory: [{ category: "WAREN", label: "Wareneinkauf (Lebensmittel)", cents: 4_990 }] },
      employees: [],
      partners: [{
        partnerId: "p1", name: "Samir Haddad", openingCents: 0, depositCents: 0, drawCents: 0, profitCents: 0, closingCents: 0,
        outlayOpeningCents: 0, outlayCents: 100_000, refundCents: 40_000, outlayClosingCents: 60_000,
        budgetOpeningCents: 0, budgetClosingCents: 200_000, expenseCents: 4_990, purchaseCapitalCents: 0,
      }],
      entryCount: 0,
    };
    const pdf = await renderReportPdf("Test GmbH", s, [], "Einnahmen- & Ausgabenprotokoll", false, []);
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    if (process.env.PDF_PREVIEW_DIR) writeFileSync(path.join(process.env.PDF_PREVIEW_DIR, "partner-report.pdf"), pdf);
  });
});
