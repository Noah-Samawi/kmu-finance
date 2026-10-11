import { writeFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf, type InvoicePdfData } from "@/infrastructure/pdf/invoice-pdf";
import { renderPayslipPdf } from "@/infrastructure/pdf/payslip-pdf";
import { PdfWriter } from "@/infrastructure/pdf/pdf-kit";
import { calculatePayslip, monthlyGrossFromHours } from "@/domain/payroll";
import { calcInvoice } from "@/domain/invoice";

const preview = (name: string, pdf: Uint8Array) => {
  const dir = process.env.PDF_PREVIEW_DIR;
  if (dir) writeFileSync(path.join(dir, name), pdf);
};

const issuer: InvoicePdfData["issuer"] = {
  legalName: "Restaurant Mustername", street: "Musterstraße 1", zip: "60311", city: "Frankfurt am Main",
  taxNumber: "14/123/45678", vatId: "DE123456789", iban: "DE00 0000 0000 0000 0000 00", bic: "COBADEFFXXX",
  smallBusiness: false, logoKey: null, invoiceFooter: "Amtsgericht Frankfurt HRB 1",
  bankName: "Commerzbank", invoiceEmail: "info@example.de", website: "www.example.de",
  tagline: "Küche · Gastronomie · Hospitality", ownerName: "Max Mustermann",
};

const items = [
  { position: 1, description: "Catering / Speisen\nBeispiel: Buffet für eine Veranstaltung", quantity: "20", unit: "Pers.", unitPriceCents: 1800, vatRate: 1900 },
  { position: 2, description: "Getränkepauschale\nBeispiel: alkoholfreie Getränke", quantity: "20", unit: "Pers.", unitPriceCents: 500, vatRate: 1900 },
];

async function invoice(over: Partial<InvoicePdfData> = {}) {
  const calc = calcInvoice(items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, unitPriceCents: i.unitPriceCents, vatRate: i.vatRate })), false);
  return renderInvoicePdf({
    number: "RE-2026-0014", isDraft: false, isCancellation: false,
    issueDate: new Date("2026-10-11T12:00:00Z"), serviceDate: new Date("2026-10-10T12:00:00Z"),
    dueDate: new Date("2026-10-25T12:00:00Z"), notes: null, paymentMethod: "TRANSFER",
    issuer,
    recipient: { name: "Musterfirma GmbH", street: "Musterstraße 12", zip: "60311", city: "Frankfurt am Main", vatId: null },
    items: items.map((i, idx) => ({ ...i, lineNetCents: calc.items[idx].lineNetCents, lineVatCents: calc.items[idx].lineVatCents })),
    netCents: calc.netCents, vatCents: calc.vatCents, grossCents: calc.grossCents,
    ...over,
  });
}

describe("PDF-Export", () => {
  it("Rechnung nach Muster: 460,00 netto + 19 % = 547,40 brutto", async () => {
    const calc = calcInvoice(items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, unitPriceCents: i.unitPriceCents, vatRate: i.vatRate })), false);
    expect(calc.netCents).toBe(46000);
    expect(calc.vatCents).toBe(8740);
    expect(calc.grossCents).toBe(54740);
    const pdf = await invoice();
    preview("rechnung.pdf", pdf);
    expect(Buffer.from(pdf.subarray(0, 4)).toString()).toBe("%PDF");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it("Rechnung mit arabischen Angaben (UTF-8/RTL) und 7 %", async () => {
    const pdf = await invoice({
      recipient: { name: "مطعم الشام – Damaskus GmbH", street: "شارع الملك 12", zip: "60311", city: "Frankfurt am Main", vatId: null },
      items: [{
        position: 1, description: "وجبة مشاوي\nGrillplatte für 2 Personen", quantity: "2", unit: "Stk.",
        unitPriceCents: 2500, vatRate: 700, lineNetCents: 5000, lineVatCents: 350,
      }],
      netCents: 5000, vatCents: 350, grossCents: 5350, notes: "شكراً لزيارتكم – Vielen Dank!",
    });
    preview("rechnung-ar.pdf", pdf);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });

  it("Gehaltsabrechnung DATEV: 160 Std × 15,00 € (auch mit arabischem Namen)", async () => {
    const gross = monthlyGrossFromHours(160, 1500);
    expect(gross).toBe(240000);
    const calc = calculatePayslip({ grossCents: gross, taxClass: 1, childAllowances: 0, churchTax: "NONE", kvAdditionalBp: 250 });
    const pdf = await renderPayslipPdf({
      ...calc,
      employer: { name: "Betrieb", legalName: "Betrieb GmbH", street: "Grugaplatz 2", zip: "45131", city: "Essen" },
      employeeName: "Noah Al-Samawi (نوح السماوي)", employeeStreet: "Im Mellsig 30", employeeZip: "60433", employeeCity: "Frankfurt am Main",
      year: 2026, month: 1, taxClass: 1, churchTax: "NONE", childAllowances: 0,
      hoursWorked: 160, hourlyRateCents: 1500, weeklyHours: 40, kvAdditionalBp: 250, personnelNumber: "PN-10003",
      pgrs: "101", bgrs: "1111", healthInsuranceName: "hkk", socialSecurityNumber: "52010185A068",
      taxId: "96734501234", iban: "DE92 5004 0000 0705 1527 00", bic: "COBADEFFXXX",
      dateOfBirth: new Date("2001-01-01T12:00:00Z"), startDate: new Date("2018-04-01T12:00:00Z"),
      issuedAt: new Date("2026-01-24T12:00:00Z"),
    });
    preview("lohn.pdf", pdf);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    expect(calc.payoutCents).toBe(calc.netCents);
    expect(calc.grossCents - calc.taxDeductionCents - calc.svDeductionCents).toBe(calc.netCents);
  });

  it("setzt arabische Läufe rechts-nach-links und Latein über die Standardschrift", async () => {
    const w = await PdfWriter.create();
    const ltr = w.runs("Rechnung Nr. 5");
    expect(ltr).toHaveLength(1);
    expect(ltr[0].font).toBe(w.font);
    const mixed = w.runs("فاتورة رقم 5");
    // RTL-Grundrichtung: Zahl steht visuell links vom arabischen Text
    expect(mixed[0].text.trim()).toBe("5");
    expect(mixed[mixed.length - 1].text).toContain("فاتورة");
    expect(w.measure("مرحبا", 10)).toBeGreaterThan(0);
  });
});
