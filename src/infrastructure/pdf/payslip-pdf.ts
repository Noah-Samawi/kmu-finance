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
  const addr = [p.employer.legalName || p.employer.name, p.employer.street, [p.employer.zip, p.employer.city].filter(Boolean).join(" ")].filter((x): x is string => !!x);

  w.line(addr[0] ?? p.employer.name, { size: 11, bold: true });
  for (const l of addr.slice(1)) w.line(l, { size: 8, color: [0.3, 0.3, 0.34] });

  const saveY = w.y;
  w.y = A4.h - MARGIN;
  w.text("Entgeltabrechnung", { x: 330, size: 14, bold: true, align: "right", width: width - 280 });
  w.y -= 16;
  w.text(`nach § 108 GewO`, { x: 330, size: 7, color: [0.4, 0.4, 0.45], align: "right", width: width - 280 });
  w.y -= 12;
  w.text(period, { x: 330, size: 11, bold: true, align: "right", width: width - 280 });
  w.y = Math.min(saveY, w.y) - 8;
  w.hr(10);

  w.line("Arbeitnehmer", { size: 8, bold: true });
  w.line(p.employeeName, { size: 10, bold: true });
  if (p.employeeStreet) w.line(p.employeeStreet, { size: 9 });
  if (p.employeeZip || p.employeeCity) w.line(`${p.employeeZip ?? ""} ${p.employeeCity ?? ""}`.trim(), { size: 9 });
  w.y -= 6;

  w.tableBoxed(
    [
      { title: "Personal-Nr.", width: 78 },
      { title: "Geburtsdatum", width: 72 },
      { title: "Eintritt", width: 72 },
      { title: "StKl", width: 36 },
      { title: "KiFb", width: 36 },
      { title: "PGRS", width: 40 },
      { title: "BGRS", width: width - 334 },
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
  w.y -= 4;
  w.tableBoxed(
    [
      { title: "SV-Nummer", width: 120 },
      { title: "IdNr.", width: 110 },
      { title: "Krankenkasse", width: 140 },
      { title: "Kirchensteuer", width: width - 370 },
    ],
    [[p.socialSecurityNumber || "–", p.taxId || "–", p.healthInsuranceName || "–", church]],
    7,
  );
  w.y -= 8;

  w.line("Brutto-Bezüge", { size: 10, bold: true });
  w.tableBoxed(
    [
      { title: "Lohnart", width: 220 },
      { title: "Menge", width: 70, align: "right" },
      { title: "Faktor", width: 90, align: "right" },
      { title: "Betrag", width: width - 380, align: "right" },
    ],
    [
      wageLine
        ? ["001 Zeitlohn Std.", qty(hours), formatCents(rate), formatCents(p.grossCents)]
        : ["001 Gehalt", "1,00", formatCents(p.grossCents), formatCents(p.grossCents)],
      ["Gesamt-Brutto", "", "", formatCents(p.grossCents)],
    ],
    8,
  );
  w.y -= 10;

  w.line("Steuer und Sozialversicherung", { size: 10, bold: true });
  const half = (width - 12) / 2;
  const taxRows = [
    ["Steuer-Brutto", formatCents(p.taxGrossCents)],
    ["Lohnsteuer", formatCents(-p.wageTaxCents)],
    ["SolZ", formatCents(-p.soliCents)],
    ["Kirchensteuer", formatCents(-p.churchTaxCents)],
    ["Steuerrechtliche Abzüge", formatCents(-p.taxDeductionCents)],
  ];
  const svRows = [
    ["SV-Brutto KV/PV", formatCents(p.svGrossCents)],
    [`KV AN (inkl. Zusatz)`, formatCents(-p.kvCents)],
    ["RV AN", formatCents(-p.rvCents)],
    ["AV AN", formatCents(-p.avCents)],
    ["PV AN", formatCents(-p.pvCents)],
    ["SV-rechtliche Abzüge", formatCents(-p.svDeductionCents)],
  ];
  const blockY = w.y;
  drawMiniTable(w, MARGIN, blockY, half, "Steuer", taxRows);
  drawMiniTable(w, MARGIN + half + 12, blockY, half, "Sozialversicherung AN", svRows);
  w.y = blockY - 16 * Math.max(taxRows.length, svRows.length) - 28;

  w.line("Berechnung und Auszahlung", { size: 10, bold: true });
  w.tableBoxed(
    [{ title: "Position", width: 330 }, { title: "Betrag", width: width - 330, align: "right" }],
    [
      ["Gesamt-Brutto", formatCents(p.grossCents)],
      ["./. Steuerrechtliche Abzüge", formatCents(-p.taxDeductionCents)],
      ["./. SV-rechtliche Abzüge", formatCents(-p.svDeductionCents)],
      ["= Netto-Verdienst", formatCents(p.netCents)],
      ["+/- Netto-Bezüge / Netto-Abzüge", formatCents(0)],
    ],
    8,
  );
  w.y -= 8;
  w.ensureSpace(36);
  w.fillRect(MARGIN, w.y - 10, width, 28, [0.12, 0.22, 0.38]);
  w.text("AUSZAHLUNGSBETRAG", { x: MARGIN + 8, size: 10, bold: true, color: [1, 1, 1] });
  w.text(formatCents(p.payoutCents), { x: MARGIN, size: 12, bold: true, color: [1, 1, 1], align: "right", width });
  w.y -= 36;

  w.line("Arbeitgeber-Kosten (nicht auszahlungsrelevant)", { size: 8, bold: true, color: [0.35, 0.35, 0.4] });
  w.tableBoxed(
    [
      { title: "SV-AG", width: 110 },
      { title: "KV", width: 80, align: "right" },
      { title: "RV", width: 80, align: "right" },
      { title: "AV", width: 80, align: "right" },
      { title: "PV", width: width - 350, align: "right" },
    ],
    [[
      formatCents(p.employerSvCents),
      formatCents(p.kvAgCents),
      formatCents(p.rvAgCents),
      formatCents(p.avAgCents),
      formatCents(p.pvAgCents),
    ]],
    8,
  );
  w.y -= 4;
  w.line(`Gesamtkosten Arbeitgeber: ${formatCents(p.employerCostCents)}`, { size: 9, bold: true });
  const payTo = [p.iban && `IBAN ${p.iban}`, p.bic && `BIC ${p.bic}`].filter(Boolean).join("  ·  ");
  if (payTo) w.line(`Auszahlung auf: ${payTo}`, { size: 8 });
  w.y -= 6;
  w.paragraph("Gesetzesnahe Näherung (SV 2026, ESt-Tarif 2025). Kein Ersatz für die Abrechnung durch ein Lohnbüro.", width, { size: 7 });

  w.footerOnAllPages("", [
    `${p.employer.legalName || p.employer.name} · Entgeltabrechnung ${period}`,
    "Entgeltabrechnung gemäß § 108 GewO",
  ]);
  return w.save();
}

function drawMiniTable(w: PdfWriter, x: number, topY: number, colW: number, title: string, rows: string[][]) {
  const rowH = 14;
  const headerH = 16;
  w.y = topY;
  w.page.drawRectangle({
    x, y: topY - headerH + 4, width: colW, height: headerH,
    color: undefined as never,
  });
  w.fillRect(x, topY - headerH + 6, colW, headerH, [0.93, 0.94, 0.96]);
  w.text(title, { x: x + 4, size: 8, bold: true });
  let y = topY - headerH - 4;
  rows.forEach(([a, b], i) => {
    const last = i === rows.length - 1;
    w.y = y;
    w.text(a, { x: x + 4, size: last ? 8 : 7.5, bold: last });
    w.text(b, { x, size: last ? 8 : 7.5, bold: last, align: "right", width: colW - 4 });
    y -= rowH;
  });
}
