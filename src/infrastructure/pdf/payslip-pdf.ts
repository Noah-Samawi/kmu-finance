import { rgb } from "pdf-lib";
import type { ChurchTax, PayrollResult } from "@/domain/payroll";
import { fmtDate } from "@/domain/period";
import { PdfWriter, A4, type TextOpts } from "./pdf-kit";

const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
/** DATEV-Zahlenformat: ohne Währungszeichen, Minus nachgestellt */
const num = (cents: number) => {
  const s = (Math.abs(cents) / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cents < 0 ? `${s}-` : s;
};
const dec = (n: number, d = 2) => n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

export interface PayslipYtd {
  grossCents: number; wageTaxCents: number; churchTaxCents: number; soliCents: number;
  kvCents: number; rvCents: number; avCents: number; pvCents: number;
}

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
  weeklyHours?: number | null;
  kvAdditionalBp?: number | null;
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
  issuedAt?: Date | null;
  /** Jahressummen inkl. dieses Monats (Verdienstbescheinigung) */
  ytd?: PayslipYtd | null;
}

const L = 40;
const R = A4.w - 40;
const RX = 462; // Beginn der rechten Betragsspalte
const LINE: [number, number, number] = [0.15, 0.15, 0.17];
const LABEL: [number, number, number] = [0.25, 0.25, 0.28];

export async function renderPayslipPdf(p: PayslipPdfInput) {
  const w = await PdfWriter.create();
  const pg = w.page;
  const Y = (top: number) => A4.h - top;
  const lab = (t: string, x: number, top: number, o: TextOpts = {}) =>
    w.drawAt(pg, t, x, Y(top), { size: 5.6, color: LABEL, ...o });
  const val = (t: string, x: number, top: number, o: TextOpts = {}) =>
    w.drawAt(pg, t, x, Y(top), { size: 8.2, face: "mono", color: [0.05, 0.05, 0.06], ...o });
  const hl = (top: number, x1 = L, x2 = R, t = 0.6) => w.hLine(x1, x2, Y(top), t, LINE);
  const vl = (x: number, top: number, bottom: number, t = 0.6) => w.vLine(x, Y(top), Y(bottom), t, LINE);

  const firm = p.employer.legalName || p.employer.name;
  const period = `${MONTHS[p.month - 1]} ${p.year}`;
  const hours = p.hoursWorked ?? 0;
  const rate = p.hourlyRateCents ?? 0;
  const byHours = hours > 0 && rate > 0;
  const konf = p.churchTax === "NONE" ? "--" : "ev/rk";
  // Ohne Konfession: keine Kirchensteuer – weder Betrag noch Spalte oder Jahreszeile
  const showChurch = p.churchTax !== "NONE" && (p.churchTaxCents > 0 || (p.ytd?.churchTaxCents ?? 0) > 0);
  const ytd: PayslipYtd = p.ytd ?? {
    grossCents: p.grossCents, wageTaxCents: p.wageTaxCents, churchTaxCents: p.churchTaxCents, soliCents: p.soliCents,
    kvCents: p.kvCents, rvCents: p.rvCents, avCents: p.avCents, pvCents: p.pvCents,
  };

  // ── Kopf ──
  w.drawAt(pg, "Abrechnung der Brutto/Netto-Bezüge", L, Y(46), { size: 10.5, bold: true });
  val(`für ${period}`, 236, 46, { size: 10 });
  val(fmtDate(p.issuedAt ?? new Date()), R - 160, 46, { size: 9, width: 110, align: "right" });
  lab("Blatt:", R - 40, 46, { size: 6 });
  val("1", R - 20, 46, { size: 9, width: 20, align: "right" });
  hl(51, L, R, 0.9);

  // Stammdaten Zeile 1
  const row1: [string, string, number][] = [
    ["Personal-Nr.", p.personnelNumber || "–", L],
    ["Geburtsdatum", p.dateOfBirth ? fmtDate(p.dateOfBirth) : "–", 102],
    ["StKl", String(p.taxClass), 160],
    ["Faktor", "", 182],
    ["Ki.Frbtr.", dec(p.childAllowances, 1), 210],
    ["Konfession", konf, 248],
    ["Freibetrag jährl.", "", 292],
    ["Freibetrag mtl.", "", 348],
    ["DBA", "", 402],
    ["Midijob", "", 424],
    ["St.-Tg.", "30", 462],
    ["Url. Anspr.", "", 492],
    ["Resturlaub", "", 526],
  ];
  for (const [k, v, x] of row1) { lab(k, x, 58); if (v) val(v, x, 69); }
  // Stammdaten Zeile 2
  const kk = p.kvAdditionalBp != null ? dec(p.kvAdditionalBp / 100) : "";
  const row2: [string, string, number][] = [
    ["SV-Nummer", p.socialSecurityNumber || "–", L],
    ["Krankenkasse", p.healthInsuranceName || "–", 130],
    ["KK %", kk, 292],
    ["PGRS", p.pgrs || "101", 322],
    ["BGRS", p.bgrs || "1111", 350],
    ["Um. SV-Tg.", "30", 384],
    ["Eintritt", p.startDate ? fmtDate(p.startDate) : "–", 424],
    ["Austritt", "", 478],
  ];
  row2.forEach(([k, v, x], i) => {
    lab(k, x, 80);
    const next = row2[i + 1]?.[2] ?? R;
    if (v) val(w.fit(v, next - x - 4, 8.2, { face: "mono" }), x, 91);
  });
  lab("Steuer-ID", 424, 102);
  val(p.taxId || "–", 424, 113);
  hl(119, L, R, 0.4);

  // Anschriftfeld (Fensterumschlag)
  const ret = [firm, p.employer.street, [p.employer.zip, p.employer.city].filter(Boolean).join(" ")].filter(Boolean).join(" * ");
  val(w.fit(ret, 300, 5.6, { face: "mono" }), L, 140, { size: 5.6 });
  val(`*Pers.-Nr. ${p.personnelNumber || "–"}*`, L, 156, { size: 7 });
  const addr = [p.employeeName, p.employeeStreet, [p.employeeZip, p.employeeCity].filter(Boolean).join(" ")]
    .filter((x): x is string => !!x);
  addr.forEach((a, i) => val(w.fit(a, 300, 9.5, { face: "mono" }), L + 6, 186 + i * 12, { size: 9.5 }));

  // Hinweise zur Abrechnung
  lab("Hinweise zur Abrechnung", 330, 140, { bold: true, size: 6 });
  hl(143, 330, R, 0.4);
  const hints = [
    p.weeklyHours ? `Wöch.Arb.Zt.  ${dec(p.weeklyHours)}` : null,
    byHours ? `Std.-Lohn     ${dec(rate / 100)}` : null,
    p.jobTitle ? w.fit(p.jobTitle, R - 330, 8.2, { face: "mono" }) : null,
  ].filter((x): x is string => !!x);
  hints.forEach((h, i) => val(h, 330, 156 + i * 11));

  // ── Brutto-Bezüge ──
  const BT = 262;
  hl(BT, L, R, 0.9);
  lab("Brutto-Bezüge", L, BT + 8, { bold: true, size: 6 });
  val(w.fit(firm, 260, 7.5, { face: "mono", bold: true }), 160, BT + 9, { size: 7.5, bold: true });
  const colX = { la: L, bez: 70, ein: 268, mengeR: 330, faktorR: 376, prozR: 418, st: 424, sv: 434, gb: 444 };
  lab("Lohnart", colX.la, BT + 18);
  lab("Bezeichnung", colX.bez, BT + 18);
  lab("Einheit", colX.ein, BT + 18);
  lab("Menge", colX.mengeR - 40, BT + 18, { width: 40, align: "right" });
  lab("Faktor", colX.faktorR - 40, BT + 18, { width: 40, align: "right" });
  lab("Prozentsatz", colX.prozR - 40, BT + 18, { width: 40, align: "right" });
  lab("St", colX.st, BT + 18); lab("SV", colX.sv, BT + 18); lab("GB", colX.gb, BT + 18);
  lab("Betrag", RX, BT + 18, { width: R - RX - 4, align: "right", bold: true });
  hl(BT + 21, L, R, 0.4);
  const wageRow = byHours
    ? { la: "001", bez: "Zeitlohn", ein: "Std", menge: dec(hours), faktor: dec(rate / 100) }
    : { la: "001", bez: "Gehalt", ein: "", menge: "", faktor: "" };
  const rt = BT + 34;
  val(wageRow.la, colX.la + 4, rt);
  val(wageRow.bez, colX.bez, rt);
  val(wageRow.ein, colX.ein, rt);
  val(wageRow.menge, colX.mengeR - 50, rt, { width: 50, align: "right" });
  val(wageRow.faktor, colX.faktorR - 46, rt, { width: 46, align: "right" });
  val("L", colX.st, rt); val("L", colX.sv, rt); val("J", colX.gb, rt);
  val(num(p.grossCents), RX, rt, { width: R - RX - 4, align: "right", bold: true });
  val("****  Bei Fragen zur Gehaltsabrechnung wenden Sie sich bitte", L, rt + 24, { size: 8 });
  val(w.fit(`****  an ${firm}${p.employer.city ? `, ${p.employer.city}` : ""}.`, RX - L - 10, 8, { face: "mono" }), L, rt + 35, { size: 8 });

  // ── rechte Betragsspalte ──
  const BOTTOM = 742;
  vl(RX - 4, BT, BOTTOM - 28, 0.6);
  const rightBox = (label: string, value: string, top: number) => {
    hl(top, RX - 4, R, 0.6);
    lab(label, RX, top + 7, { width: R - RX - 4, align: "right", bold: true });
    val(value, RX, top + 20, { width: R - RX - 4, align: "right", bold: true, size: 9 });
    w.hLine(R - 70, R - 4, Y(top + 23), 0.5, LINE);
  };

  // ── Steuer / Sozialversicherung ──
  const ST = 420;
  hl(ST, L, RX - 4, 0.9);
  lab("Steuer/Sozialversicherung", L, ST + 8, { bold: true, size: 6 });
  rightBox("Gesamt-Brutto", num(p.grossCents), ST - 16);
  const sCols = [L + 22, 132, 220, 308];
  lab("St", L, ST + 18, { bold: true });
  const taxCols: [string, number][] = [
    ["Steuer-Brutto", p.taxGrossCents], ["Lohnsteuer", p.wageTaxCents],
    ...(showChurch ? [["Kirchensteuer", p.churchTaxCents] as [string, number]] : []),
    ["Solidaritätszuschlag", p.soliCents],
  ];
  taxCols.forEach(([t], i) => lab(t, sCols[i], ST + 18));
  val("L", L, ST + 31);
  taxCols.forEach(([, c], i) => val(num(c), sCols[i] - 4, ST + 31, { width: 72, align: "right" }));
  rightBox("Steuerrechtliche Abzüge", num(p.taxDeductionCents), ST + 18);

  const SV = ST + 54;
  const cw = (RX - 4 - (L + 22)) / 8;
  const svX = Array.from({ length: 8 }, (_, i) => L + 22 + i * cw);
  lab("SV", L, SV + 6, { bold: true });
  ["KV-Brutto", "RV-Brutto", "AV-Brutto", "PV-Brutto", "KV-Beitrag", "RV-Beitrag", "AV-Beitrag", "PV-Beitrag"]
    .forEach((t, i) => lab(t, svX[i], SV + 6, { width: cw - 3, align: "right" }));
  val("L", L, SV + 19);
  [p.svGrossCents, p.svGrossCents, p.svGrossCents, p.svGrossCents, p.kvCents, p.rvCents, p.avCents, p.pvCents]
    .forEach((c, i) => val(num(c), svX[i], SV + 19, { width: cw - 3, align: "right", size: 7.4 }));
  rightBox("SV-rechtliche Abzüge", num(p.svDeductionCents), SV);

  // ── Verdienstbescheinigung + Netto-Bezüge/Netto-Abzüge ──
  const VT = SV + 50;
  hl(VT, L, RX - 4, 0.9);
  rightBox("Netto-Verdienst", num(p.netCents), VT - 16);
  lab("Verdienstbescheinigung", L, VT + 8, { bold: true, size: 6 });
  lab(`Jahreswerte ${p.year}`, 130, VT + 8);
  const vMid = 250;
  vl(vMid, VT, VT + 128, 0.4);
  const leftRows: [string, number][] = [
    ["Gesamt-Brutto", ytd.grossCents], ["Steuer-Brutto", ytd.grossCents], ["Lohnsteuer", ytd.wageTaxCents],
    ...(showChurch ? [["Kirchensteuer", ytd.churchTaxCents] as [string, number]] : []),
    ["Solidaritätszuschlag", ytd.soliCents],
  ];
  const svRows: [string, number][] = [
    ["SV-Brutto", ytd.grossCents], ["KV-Beitrag", ytd.kvCents], ["RV-Beitrag", ytd.rvCents],
    ["AV-Beitrag", ytd.avCents], ["PV-Beitrag", ytd.pvCents],
  ];
  leftRows.forEach(([k, c], i) => { lab(k, L, VT + 22 + i * 13); val(num(c), 85, VT + 22 + i * 13, { width: 58, align: "right", size: 7.6 }); });
  svRows.forEach(([k, c], i) => { lab(k, 148, VT + 22 + i * 13); val(num(c), 185, VT + 22 + i * 13, { width: 60, align: "right", size: 7.6 }); });

  lab("Netto-Bezüge/Netto-Abzüge", vMid + 6, VT + 8, { bold: true, size: 6 });
  lab("Nr.", vMid + 6, VT + 18); lab("Bezeichnung", vMid + 30, VT + 18);
  val("keine", vMid + 30, VT + 31, { size: 7.6 });
  rightBox("Betrag", num(0), VT + 8);

  // ── Auszahlung / Bank / AG-Kosten ──
  const FT = BOTTOM - 22;
  hl(FT, L, RX - 4, 0.9);
  lab("Bank", L, FT + 10); val(p.bic || "–", L + 26, FT + 10);
  lab("Konto", L, FT + 23); val(p.iban || "–", L + 26, FT + 23, { size: 8.6, bold: true });
  lab("SV-AG-Anteil", 286, FT + 10, { width: 50, align: "right" });
  lab("Zus. AG-Kosten", 340, FT + 10, { width: 50, align: "right" });
  lab("Gesamtkosten", 394, FT + 10, { width: 62, align: "right" });
  val(num(p.employerSvCents), 280, FT + 23, { width: 56, align: "right", size: 7.8 });
  val(num(0), 340, FT + 23, { width: 50, align: "right", size: 7.8 });
  val(num(p.employerCostCents), 394, FT + 23, { width: 62, align: "right", size: 7.8 });

  // hervorgehobene Auszahlung
  const boxTop = FT - 6;
  pg.drawRectangle({ x: RX - 4, y: Y(boxTop + 36), width: R - RX + 4, height: 36, color: rgb(0.08, 0.08, 0.1) });
  lab("Auszahlungsbetrag", RX, boxTop + 11, { width: R - RX - 6, align: "right", bold: true, color: [1, 1, 1], size: 6.4 });
  val(`${num(p.payoutCents)} EUR`, RX, boxTop + 28, { width: R - RX - 6, align: "right", bold: true, size: 10.5, color: [1, 1, 1] });

  // Legende + Rechtshinweis
  const leg = [
    "St / SV: L = Laufender Bezug, S = Sonstiger Bezug, F = Frei, P = Pauschal   ·   GB: J = Bestandteil des Gesamt-Bruttos   ·   Std = Stunden",
    "Berechnung als gesetzesnahe Näherung (Sozialversicherung 2026, Einkommensteuertarif 2025); maßgeblich ist die Meldung an Finanzamt und Krankenkasse.",
  ];
  leg.forEach((t, i) => lab(w.fit(t, R - L, 5.2), L, BOTTOM + 40 + i * 8, { size: 5.2 }));
  w.drawAt(pg, "- Dies ist eine Entgeltbescheinigung nach § 108 Abs. 3 Satz 1 der Gewerbeordnung -", L, Y(BOTTOM + 62), {
    size: 6, width: R - L, align: "center", color: LABEL,
  });
  return w.save();
}
