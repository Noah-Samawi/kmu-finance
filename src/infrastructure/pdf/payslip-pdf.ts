import { formatCents } from "@/domain/money";
import type { ChurchTax, PayrollResult } from "@/domain/payroll";
import { fmtDate } from "@/domain/period";
import { PdfWriter, A4, MARGIN } from "./pdf-kit";

const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
const qty = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface PayslipPdfInput extends PayrollResult {
  employer: {
    name: string; legalName?: string | null; street?: string | null; zip?: string | null; city?: string | null;
  };
  employeeName: string;
  employeeStreet?: string | null;
  employeeZip?: string | null;
  employeeCity?: string | null;
  year: number;
  month: number;
  taxClass: number;
  churchTax: ChurchTax;
  childAllowances: number;
  hoursWorked?: number | null;
  hourlyRateCents?: number;
  jobTitle?: string | null;
  iban?: string | null;
  bic?: string | null;
  dateOfBirth?: Date | null;
  startDate?: Date | null;
  socialSecurityNumber?: string | null;
  taxId?: string | null;
  healthInsuranceName?: string | null;
  personnelNumber?: string | null;
  pgrs?: string | null;
  bgrs?: string | null;
}

export async function renderPayslipPdf(p: PayslipPdfInput) {
  const w = await PdfWriter.create();
  const width = A4.w - 2 * MARGIN;
  const period = `${MONTHS[p.month - 1]} ${p.year}`;
  const church = p.churchTax === "NONE" ? "–" : p.churchTax === "NINE" ? "ev/rk 9 %" : "ev/rk 8 %";
  const hours = p.hoursWorked ?? 0;
  const rate = p.hourlyRateCents ?? 0;
  const wageLine = hours > 0 && rate > 0;
  const firm = p.employer.legalName || p.employer.name;

  w.y = A4.h - 42;
  w.line("Abrechnung der Brutto/Netto-Bezüge", { size: 12, bold: true, width: 300 });
  w.line(`für ${period}`, { size: 10, width: 300 });
  w.line(firm, { size: 8, color: [0.3, 0.3, 0.34], width: 300 });
  if (p.employer.street) w.line(p.employer.street, { size: 8, color: [0.3, 0.3, 0.34], width: 300 });
  if (p.employer.zip || p.employer.city) {
    w.line([p.employer.zip, p.employer.city].filter(Boolean).join(" "), { size: 8, color: [0.3, 0.3, 0.34], width: 300 });
  }

  w.y -= 8;
  w.line(p.employeeName, { size: 11, bold: true, width: width });
  if (p.employeeStreet) w.line(p.employeeStreet, { size: 9, width: width });
  if (p.employeeZip || p.employeeCity) {
    w.line(`${p.employeeZip ?? ""} ${p.employeeCity ?? ""}`.trim(), { size: 9, width: width });
  }
  w.y -= 8;

  w.tableOpen(
    [
      { title: "Pers.-Nr.", width: 72 },
      { title: "Geburtsdatum", width: 78 },
      { title: "Eintritt", width: 72 },
      { title: "StKl", width: 36 },
      { title: "KiFb", width: 36 },
      { title: "PGRS", width: 44 },
      { title: "BGRS", width: width - 338 },
    ],
    [[
      p.personnelNumber || "–",
      fmtDate(p.dateOfBirth ?? null),
      fmtDate(p.startDate ?? null),
      String(p.taxClass),
      String(p.childAllowances),
      p.pgrs || "101",
      p.bgrs || "1111",
    ]],
    7,
  );
  w.y -= 2;
  w.tableOpen(
    [
      { title: "SV-Nummer", width: 120 },
      { title: "Steuer-ID", width: 110 },
      { title: "Krankenkasse", width: 150 },
      { title: "Konfession", width: width - 380 },
    ],
    [[p.socialSecurityNumber || "–", p.taxId || "–", p.healthInsuranceName || "–", church]],
    7,
  );
  w.y -= 10;

  w.line("Brutto-Bezüge", { size: 10, bold: true, width });
  w.tableOpen(
    [
      { title: "Lohnart", width: 70 },
      { title: "Bezeichnung", width: 150 },
      { title: "Menge", width: 70, align: "right" },
      { title: "Faktor", width: 90, align: "right" },
      { title: "Betrag", width: width - 380, align: "right" },
    ],
    [
      wageLine
        ? ["001", "Zeitlohn Std.", qty(hours), formatCents(rate), formatCents(p.grossCents)]
        : ["001", "Gehalt", "1,00", formatCents(p.grossCents), formatCents(p.grossCents)],
    ],
    8,
  );
  w.y -= 8;

  w.line("Steuerrechtliche Abzüge", { size: 10, bold: true, width });
  w.tableOpen(
    [
      { title: "Steuer-Brutto", width: 110, align: "right" },
      { title: "Lohnsteuer", width: 110, align: "right" },
      { title: "SolZ", width: 90, align: "right" },
      { title: "Kirchensteuer", width: width - 310, align: "right" },
    ],
    [[
      formatCents(p.taxGrossCents),
      formatCents(p.wageTaxCents),
      formatCents(p.soliCents),
      formatCents(p.churchTaxCents),
    ]],
    8,
  );
  w.y -= 8;

  w.line("SV-rechtliche Abzüge (Arbeitnehmer)", { size: 10, bold: true, width });
  w.tableOpen(
    [
      { title: "SV-Brutto", width: 90, align: "right" },
      { title: "KV AN", width: 80, align: "right" },
      { title: "RV AN", width: 80, align: "right" },
      { title: "AV AN", width: 80, align: "right" },
      { title: "PV AN", width: width - 330, align: "right" },
    ],
    [[
      formatCents(p.svGrossCents),
      formatCents(p.kvCents),
      formatCents(p.rvCents),
      formatCents(p.avCents),
      formatCents(p.pvCents),
    ]],
    8,
  );
  w.y -= 8;

  w.line("Berechnung", { size: 10, bold: true, width });
  w.tableOpen(
    [{ title: "Position", width: 330 }, { title: "Betrag", width: width - 330, align: "right" }],
    [
      ["Gesamt-Brutto", formatCents(p.grossCents)],
      ["Steuerrechtliche Abzüge", formatCents(-p.taxDeductionCents)],
      ["SV-rechtliche Abzüge", formatCents(-p.svDeductionCents)],
      ["Netto-Verdienst", formatCents(p.netCents)],
    ],
    8,
  );
  w.y -= 10;
  w.ensureSpace(32);
  w.fillRect(MARGIN, w.y - 8, width, 24, [0.12, 0.12, 0.14]);
  w.text("Auszahlungsbetrag", { x: MARGIN + 8, size: 10, bold: true, color: [1, 1, 1] });
  w.text(formatCents(p.payoutCents), { x: MARGIN, size: 11, bold: true, color: [1, 1, 1], align: "right", width });
  w.y -= 34;

  w.line("Arbeitgeber (SV-AG-Anteil / Gesamtkosten)", { size: 9, bold: true, width });
  w.tableOpen(
    [
      { title: "KV AG", width: 90, align: "right" },
      { title: "RV AG", width: 90, align: "right" },
      { title: "AV AG", width: 90, align: "right" },
      { title: "PV AG", width: 90, align: "right" },
      { title: "Gesamtkosten", width: width - 360, align: "right" },
    ],
    [[
      formatCents(p.kvAgCents),
      formatCents(p.rvAgCents),
      formatCents(p.avAgCents),
      formatCents(p.pvAgCents),
      formatCents(p.employerCostCents),
    ]],
    8,
  );
  w.y -= 6;
  const payTo = [p.iban && `IBAN ${p.iban}`, p.bic && `BIC ${p.bic}`].filter(Boolean).join("   ");
  if (payTo) w.line(`Auszahlung: ${payTo}`, { size: 8, width });
  w.line("Entgeltbescheinigung nach § 108 Abs. 3 Satz 1 GewO. Gesetzesnahe Näherung (SV 2026 / ESt 2025).", { size: 7, color: [0.4, 0.4, 0.45], width });

  w.footerOnAllPages("", [`${firm} · Entgeltabrechnung ${period}`]);
  return w.save();
}
