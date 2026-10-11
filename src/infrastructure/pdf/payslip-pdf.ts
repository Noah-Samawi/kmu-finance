import { formatCents } from "@/domain/money";
import type { ChurchTax, PayrollResult } from "@/domain/payroll";
import { PdfWriter, A4, MARGIN } from "./pdf-kit";

const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

export async function renderPayslipPdf(p: PayrollResult & {
  employerName: string; employeeName: string; year: number; month: number; taxClass: number; churchTax: ChurchTax;
}) {
  const w = await PdfWriter.create();
  const width = A4.w - 2 * MARGIN;
  w.line("Lohnabrechnung", { size: 16, bold: true });
  w.line(`${p.employerName}  ·  ${MONTHS[p.month - 1]} ${p.year}`, { size: 10 });
  w.line(`Mitarbeiter: ${p.employeeName}   ·   Steuerklasse ${p.taxClass}`, { size: 10 });
  w.hr();
  w.line("Bezüge und Abzüge (Arbeitnehmeranteil, Näherung nach deutschem Recht)", { size: 11, bold: true });
  w.table(
    [{ title: "Position", width: 330 }, { title: "Betrag", width: width - 330, align: "right" }],
    [
      ["Bruttolohn", formatCents(p.grossCents)],
      ["Rentenversicherung (AN)", formatCents(-p.rvCents)],
      ["Arbeitslosenversicherung (AN)", formatCents(-p.avCents)],
      ["Krankenversicherung (AN)", formatCents(-p.kvCents)],
      ["Pflegeversicherung (AN)", formatCents(-p.pvCents)],
      ["Lohnsteuer", formatCents(-p.wageTaxCents)],
      ["Solidaritätszuschlag", formatCents(-p.soliCents)],
      [`Kirchensteuer (${p.churchTax === "NONE" ? "keine" : p.churchTax === "NINE" ? "9 %" : "8 %"})`, formatCents(-p.churchTaxCents)],
      ["Nettolohn", formatCents(p.netCents)],
    ],
  );
  w.y -= 10;
  w.paragraph("Hinweis: Sozialversicherung und Lohnsteuer sind eine gesetzesnahe Näherung (SV-Sätze 2026, ESt-Tarif 2025). Bitte vor Auszahlung mit Steuerberatung/Lohnbüro prüfen.", width, { size: 8 });
  w.footerOnAllPages(`${p.employerName} · Lohnabrechnung ${p.month}/${p.year}`);
  return w.save();
}
