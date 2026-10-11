import { formatCents } from "@/domain/money";
import type { ChurchTax, PayrollResult } from "@/domain/payroll";
import { PdfWriter, A4, MARGIN } from "./pdf-kit";

const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

export async function renderPayslipPdf(p: PayrollResult & {
  employerName: string; employeeName: string; year: number; month: number; taxClass: number; churchTax: ChurchTax;
  hoursWorked?: number | null; hourlyRateCents?: number; jobTitle?: string | null; iban?: string | null;
}) {
  const w = await PdfWriter.create();
  const width = A4.w - 2 * MARGIN;
  w.line("Lohnabrechnung", { size: 18, bold: true });
  w.line(`${p.employerName}`, { size: 11 });
  w.line(`Abrechnungszeitraum: ${MONTHS[p.month - 1]} ${p.year}`, { size: 10 });
  w.hr(14);
  w.tableBoxed(
    [{ title: "Angaben", width: 220 }, { title: "Wert", width: width - 220 }],
    [
      ["Mitarbeiter", p.employeeName],
      ["Tätigkeit", p.jobTitle || "–"],
      ["Steuerklasse", String(p.taxClass)],
      ...(p.hoursWorked != null ? [["Arbeitsstunden", p.hoursWorked.toLocaleString("de-DE", { maximumFractionDigits: 2 })] as [string, string]] : []),
      ...(p.hourlyRateCents ? [["Stundenlohn", formatCents(p.hourlyRateCents) + " / Std."] as [string, string]] : []),
      ...(p.iban ? [["Auszahlungskonto", p.iban] as [string, string]] : []),
    ],
    9,
  );
  w.y -= 12;
  w.line("Bezüge", { size: 12, bold: true });
  w.tableBoxed(
    [{ title: "Position", width: 330 }, { title: "Betrag", width: width - 330, align: "right" }],
    [["Bruttolohn", formatCents(p.grossCents)]],
  );
  w.y -= 10;
  w.line("Abzüge Sozialversicherung (Arbeitnehmeranteil)", { size: 12, bold: true });
  w.tableBoxed(
    [{ title: "Position", width: 330 }, { title: "Betrag", width: width - 330, align: "right" }],
    [
      ["Rentenversicherung", formatCents(-p.rvCents)],
      ["Arbeitslosenversicherung", formatCents(-p.avCents)],
      ["Krankenversicherung", formatCents(-p.kvCents)],
      ["Pflegeversicherung", formatCents(-p.pvCents)],
    ],
  );
  w.y -= 10;
  w.line("Steuerliche Abzüge", { size: 12, bold: true });
  w.tableBoxed(
    [{ title: "Position", width: 330 }, { title: "Betrag", width: width - 330, align: "right" }],
    [
      ["Lohnsteuer", formatCents(-p.wageTaxCents)],
      ["Solidaritätszuschlag", formatCents(-p.soliCents)],
      [`Kirchensteuer (${p.churchTax === "NONE" ? "keine" : p.churchTax === "NINE" ? "9 %" : "8 %"})`, formatCents(-p.churchTaxCents)],
    ],
  );
  w.y -= 10;
  w.tableBoxed(
    [{ title: "Position", width: 330 }, { title: "Betrag", width: width - 330, align: "right" }],
    [["Nettolohn / Auszahlungsbetrag", formatCents(p.netCents)]],
    10,
  );
  w.y -= 12;
  w.paragraph("Hinweis: Sozialversicherung und Lohnsteuer sind eine gesetzesnahe Näherung (SV-Sätze 2026, ESt-Tarif 2025). Bitte vor Auszahlung mit Steuerberatung/Lohnbüro prüfen.", width, { size: 8 });
  w.footerOnAllPages(`${p.employerName} · Lohnabrechnung ${p.month}/${p.year}`);
  return w.save();
}
