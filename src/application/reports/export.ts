// Modul D: Export für den Steuerberater (CSV + PDF)
import { eq } from "drizzle-orm";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { tenants } from "@/infrastructure/db/schema";
import { PdfWriter, A4, MARGIN } from "@/infrastructure/pdf/pdf-kit";
import { LEDGER_LABEL } from "@/domain/ledger";
import { centsToPlain, formatCents } from "@/domain/money";
import { fmtDate, fmtDateTime } from "@/domain/period";
import { requireRole, tid, type Ctx } from "../context";
import { buildSummary, ledgerRows, rangeFromDays, type LedgerRow, type Summary } from "./reports";

function typeLabel(r: LedgerRow) {
  return r.type === "REVERSAL" && r.reversedType ? `Storno ${LEDGER_LABEL[r.reversedType]}` : LEDGER_LABEL[r.type];
}

/** CSV im Excel-freundlichen deutschen Format: Semikolon, Dezimalkomma, UTF-8 mit BOM */
export function toCsv(rows: LedgerRow[]): string {
  const esc = (v: string | null | undefined) => {
    const s = (v ?? "").replace(/\r?\n/g, " ");
    // Formel-Injection in Excel verhindern
    const safe = /^[=+\-@\t]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[;"]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = ["Buchungsdatum", "Buchungs-ID", "Art", "Mitarbeiter", "Beschreibung", "Händler (Beleg)", "Rechnungsnr.", "Pool (EUR)", "Mitarbeiterkonto (EUR)"];
  const lines = [...rows].reverse().map((r) => [
    fmtDateTime(r.bookingDate), r.id, typeLabel(r), r.employeeName ?? "", r.description ?? "",
    r.receiptMerchant ?? "", r.invoiceNumber ?? "", centsToPlain(r.poolDeltaCents), centsToPlain(r.walletDeltaCents),
  ].map(esc).join(";"));
  return "﻿" + [header.join(";"), ...lines].join("\r\n") + "\r\n";
}

export async function renderReportPdf(tenantName: string, s: Summary, rows: LedgerRow[], title: string, employeeView: boolean) {
  const w = await PdfWriter.create();
  const width = A4.w - 2 * MARGIN;
  w.line(title, { size: 16, bold: true });
  w.line(`${tenantName}   ·   Zeitraum ${fmtDate(new Date(s.from + "T12:00:00Z"))} – ${fmtDate(new Date(s.to + "T12:00:00Z"))}`, { size: 9 });
  w.hr();

  if (!employeeView) {
    w.line("Einnahmen-Pool", { size: 11, bold: true });
    w.table([{ title: "Position", width: 330 }, { title: "Betrag", width: width - 330, align: "right" }], [
      ["Anfangsbestand", formatCents(s.pool.openingCents)],
      ["+ Einnahmen aus Rechnungen", formatCents(s.pool.incomeInvoiceCents)],
      ["+ Manuelle Einnahmen", formatCents(s.pool.incomeManualCents)],
      ["– Budget-Zuteilungen an Mitarbeiter", formatCents(s.pool.allocatedCents)],
      ["+ Rückführungen von Mitarbeitern", formatCents(s.pool.returnedCents)],
      ["= Rest-Kassenbestand (Ende)", formatCents(s.pool.closingCents)],
    ]);
    w.y -= 8;
    w.line("Ausgaben", { size: 11, bold: true });
    w.table([{ title: "Position", width: 330 }, { title: "Betrag", width: width - 330, align: "right" }], [
      ["Belegte Ausgaben", formatCents(s.totals.receiptsCents)],
      ["Manuelle Ausgleiche (ohne Beleg)", formatCents(s.totals.adjustmentsCents)],
      ["Offene Mitarbeiter-Guthaben (Ende)", formatCents(s.totals.walletsOpenCents)],
    ]);
    w.y -= 8;
  }

  w.line(employeeView ? "Mein Konto" : "Mitarbeiterkonten", { size: 11, bold: true });
  w.table(
    [
      { title: "Mitarbeiter", width: 115 }, { title: "Anfang", width: 64, align: "right" },
      { title: "Erhalten", width: 64, align: "right" }, { title: "Belege", width: 64, align: "right" },
      { title: "Ausgleich", width: 64, align: "right" }, { title: "Zurück", width: 64, align: "right" },
      { title: "Rest", width: width - 435, align: "right" },
    ],
    s.employees.map((e) => [e.name, formatCents(e.openingCents), formatCents(e.allocatedCents), formatCents(e.receiptsCents),
      formatCents(e.adjustmentsCents), formatCents(e.returnedCents), formatCents(e.closingCents)]),
    8,
  );
  w.y -= 8;
  w.line(`Einzelbuchungen (${rows.length})`, { size: 11, bold: true });
  w.table(
    [
      { title: "Datum", width: 70 }, { title: "Art", width: 85 }, { title: "Mitarbeiter", width: 75 },
      { title: "Beschreibung", width: 135 },
      ...(employeeView ? [] : [{ title: "Pool", width: 65, align: "right" as const }]),
      { title: "MA-Konto", width: employeeView ? width - 365 : width - 430, align: "right" },
    ],
    [...rows].reverse().map((r) => [
      fmtDateTime(r.bookingDate), typeLabel(r), r.employeeName ?? "–",
      [r.description, r.invoiceNumber].filter(Boolean).join(" · "),
      ...(employeeView ? [] : [r.poolDeltaCents ? formatCents(r.poolDeltaCents) : ""]),
      r.walletDeltaCents ? formatCents(r.walletDeltaCents) : "",
    ]),
    8,
  );
  w.footerOnAllPages(`${tenantName} · ${title} · erstellt ${fmtDateTime(new Date())}`);
  return w.save();
}

export async function exportReport(ctx: Ctx, format: "csv" | "pdf", from: string, to: string, employeeId?: string) {
  requireRole(ctx, "ADMIN", "EMPLOYEE");
  const tenantId = tid(ctx);
  const range = rangeFromDays(from, to);
  const only = ctx.role === "EMPLOYEE" ? ctx.userId : employeeId;
  const { rows, summary, tenantName } = await withTenant(ctx, async (tx) => ({
    rows: await ledgerRows(tx, tenantId, { range, employeeId: only, limit: 100_000 }),
    summary: await buildSummary(tx, tenantId, range, from, to, only),
    tenantName: (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { name: true } }))!.name,
  }));
  const base = `protokoll_${from}_${to}`;
  if (format === "csv") {
    return { filename: `${base}.csv`, mime: "text/csv; charset=utf-8", data: Buffer.from(toCsv(rows), "utf-8") };
  }
  const title = ctx.role === "EMPLOYEE" ? `Kontoprotokoll ${ctx.name}` : "Einnahmen- & Ausgabenprotokoll";
  const data = await renderReportPdf(tenantName, summary, rows, title, ctx.role === "EMPLOYEE");
  return { filename: `${base}.pdf`, mime: "application/pdf", data: Buffer.from(data) };
}
