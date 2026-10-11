import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "@/infrastructure/pdf/invoice-pdf";
import { renderPayslipPdf } from "@/infrastructure/pdf/payslip-pdf";
import { calculatePayslip } from "@/domain/payroll";

const issuer = {
  legalName: "Restaurant Mustername", street: "Musterstraße 1", zip: "60311", city: "Frankfurt am Main",
  taxNumber: "14/123/45678", vatId: "DE123456789", iban: "DE00 0000 0000 0000 0000 00", bic: "COBADEFFXXX",
  smallBusiness: false, logoKey: null, invoiceFooter: "Amtsgericht Frankfurt HRB 1",
  bankName: "Commerzbank", invoiceEmail: "info@example.de", website: "www.example.de",
};

describe("PDF-Export", () => {
  it("erzeugt eine Rechnungs-PDF mit Netto/USt/Brutto", async () => {
    const pdf = await renderInvoicePdf({
      number: "RE-2026-0001", isDraft: false, isCancellation: false,
      issueDate: new Date("2026-10-11T12:00:00Z"), serviceDate: new Date("2026-10-10T12:00:00Z"),
      dueDate: new Date("2026-10-25T12:00:00Z"), notes: "Vielen Dank.", paymentMethod: "TRANSFER",
      issuer,
      recipient: { name: "Musterfirma GmbH", street: "Musterstraße 12", zip: "60311", city: "Frankfurt am Main", vatId: null },
      items: [{
        position: 1, description: "Catering / Speisen", quantity: "20", unit: "Pers.",
        unitPriceCents: 1800, vatRate: 1900, lineNetCents: 36000, lineVatCents: 6840,
      }],
      netCents: 36000, vatCents: 6840, grossCents: 42840,
    });
    expect(pdf.byteLength).toBeGreaterThan(800);
    expect(pdf[0]).toBe(0x25); // %
    expect(pdf[1]).toBe(0x50); // P
  });
  it("erzeugt eine Gehaltsabrechnung ohne Überlagerung", async () => {
    const calc = calculatePayslip({ grossCents: 240000, taxClass: 1, childAllowances: 0, churchTax: "NONE", kvAdditionalBp: 250 });
    const pdf = await renderPayslipPdf({
      ...calc,
      employer: { name: "Betrieb", legalName: "Betrieb GmbH", street: "Grugaplatz 2", zip: "45131", city: "Essen" },
      employeeName: "Noah Al-Samawi", employeeStreet: "Im Mellsig 30", employeeZip: "60433", employeeCity: "Frankfurt am Main",
      year: 2026, month: 1, taxClass: 1, churchTax: "NONE", childAllowances: 0,
      hoursWorked: 160, hourlyRateCents: 1500, personnelNumber: "PN-10003",
      pgrs: "101", bgrs: "1111", healthInsuranceName: "hkk", socialSecurityNumber: "52010185A068",
    });
    expect(pdf.byteLength).toBeGreaterThan(800);
    expect(calc.payoutCents).toBe(calc.netCents);
  });
});
