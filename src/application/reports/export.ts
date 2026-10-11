// Modul D: Export für den Steuerberater (CSV + PDF)
import { eq } from "drizzle-orm";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { tenants } from "@/infrastructure/db/schema";
import { PdfWriter, A4, MARGIN } from "@/infrastructure/pdf/pdf-kit";
import { LEDGER_LABEL } from "@/domain/ledger";
import { centsToPlain, formatCents } from "@/domain/money";
import { fmtDate, fmtDateTime } from "@/domain/period";
import { forbidden } from "@/domain/errors";
import { requireRole, tid, type Ctx } from "../context";
import { buildSummary, ledgerRows, rangeFromDays, type LedgerRow, type Summary } from "./reports";
import { partnerBookingRows, type PartnerBookingRow } from "../partners/partner-bookings";
import { FUNDING_LABEL, PARTNER_KIND_LABEL, REFUND_STATUS_LABEL } from "@/domain/partner";

function typeLabel(r: LedgerRow) {
  return r.type === "REVERSAL" && r.reversedType ? `Storno ${LEDGER_LABEL[r.reversedType]}` : LEDGER_LABEL[r.type];
}

/** CSV im Excel-freundlichen deutschen Format: Semikolon, Dezimalkomma, UTF-8 mit BOM */
export function toCsv(rows: LedgerRow[], partnerBookings: PartnerBookingRow[] = []): string {
  const esc = (v: string | null | undefined) => {
    const s = (v ?? "").replace(/\r?\n/g, " ");
    // Formel-Injection in Excel verhindern
    const safe = /^[=+\-@\t]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[;"]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = ["Buchungsdatum", "Buchungs-ID", "Art", "Mitarbeiter", "Beschreibung", "Händler (Beleg)", "Rechnungsnr.", "Konto", "Kasse (EUR)", "Bank (EUR)", "Budget (EUR)", "Auslage-Anspruch (EUR)", "Kapital Partner (EUR)"];
  const lines = [...rows].reverse().map((r) => [
    fmtDateTime(r.bookingDate), r.id, typeLabel(r), r.employeeName ?? "", r.description ?? "",
    r.receiptMerchant ?? "", r.invoiceNumber ?? "", r.accountKind === "BANK" ? "Bank" : r.accountKind === "CASH" ? "Kasse" : "",
    centsToPlain(r.cashDeltaCents), centsToPlain(r.bankDeltaCents),
    centsToPlain(r.walletDeltaCents), centsToPlain(r.claimDeltaCents), centsToPlain(r.partnerDeltaCents),
  ].map(esc).join(";"));
  const partnerBlock = partnerBookings.length
    ? ["", ["Gesellschafter-Buchungen", "Datum", "Person", "Vorgang", "Herkunft / Konto", "Betrag (EUR)", "Wofür? / Begründung", "Beleg", "Erfasst von", "Status"].map(esc).join(";"),
      ...[...partnerBookings].reverse().map((b) => [
        b.id, fmtDate(b.bookingDate), b.partnerName, PARTNER_KIND_LABEL[b.kind], b.source ? FUNDING_LABEL[b.source] : "",
        centsToPlain(b.amountCents), b.purpose, b.hasReceipt ? "ja" : "nein", b.createdByName, partnerStatusText(b),
      ].map(esc).join(";"))]
    : [];
  return "﻿" + [header.join(";"), ...lines, ...partnerBlock].join("\r\n") + "\r\n";
}

export function partnerStatusText(b: PartnerBookingRow): string {
  if (b.reversed) return "storniert";
  if (b.kind === "OUTLAY_REFUND") {
    return b.settles.length
      ? `tilgt: ${b.settles.map((x) => `${fmtDate(x.bookingDate)} ${x.purpose} (${formatCents(x.amountCents)})`).join("; ")}`
      : "Erstattung";
  }
  if (b.status) {
    const base = REFUND_STATUS_LABEL[b.status];
    if (b.status === "REFUNDED") return "durch Admin erstattet";
    return b.status === "PARTIAL" ? `${base}, offen ${formatCents(b.openCents)}` : `${base} (${formatCents(b.openCents)})`;
  }
  if (b.kind === "OUTLAY") return "Firmenmittel – keine Erstattung";
  return "gebucht";
}

export function partnerBookingTableRows(bookings: PartnerBookingRow[]): string[][] {
  return [...bookings].reverse().map((b) => [
    fmtDate(b.bookingDate),
    b.partnerName,
    PARTNER_KIND_LABEL[b.kind],
    b.source ? FUNDING_LABEL[b.source] : "–",
    formatCents(b.amountCents),
    `${b.purpose}${b.hasReceipt ? " · Beleg" : " · ohne Beleg"}${b.selfEntered ? "" : ` · erfasst von ${b.createdByName}`}`,
    partnerStatusText(b),
  ]);
}

export async function renderReportPdf(
  tenantName: string, s: Summary, rows: LedgerRow[], title: string, employeeView: boolean, partnerBookings: PartnerBookingRow[] = [],
) {
  const w = await PdfWriter.create();
  const width = A4.w - 2 * MARGIN;
  w.line(title, { size: 16, bold: true });
  w.line(`${tenantName}   ·   Zeitraum ${fmtDate(new Date(s.from + "T12:00:00Z"))} – ${fmtDate(new Date(s.to + "T12:00:00Z"))}`, { size: 9 });
  w.hr();

  if (!employeeView) {
    w.line("Saldo-Übertrag (Anfangssaldo = Endsaldo der Vorperiode)", { size: 11, bold: true });
    w.tableOpen(
      [
        { title: "Konto", width: 220 },
        { title: "Übertrag / Anfang", width: 155, align: "right" },
        { title: "Ende", width: width - 375, align: "right" },
      ],
      [
        ["Kasse (Bar)", formatCents(s.cash.openingCents), formatCents(s.cash.closingCents)],
        ["Bankkonto", formatCents(s.bank.openingCents), formatCents(s.bank.closingCents)],
      ],
    );
    w.y -= 8;
    w.line("Einnahmen-Pool (Summe)", { size: 11, bold: true });
    w.table([{ title: "Position", width: 330 }, { title: "Betrag", width: width - 330, align: "right" }], [
      ["Anfangsbestand", formatCents(s.pool.openingCents)],
      ["+ Einnahmen aus Rechnungen", formatCents(s.pool.incomeInvoiceCents)],
      ["+ Manuelle Einnahmen", formatCents(s.pool.incomeManualCents)],
      ["– Budget-Zuteilungen (Mitarbeiter und Gesellschafter)", formatCents(s.pool.allocatedCents)],
      ["+ Budget-Rückführungen", formatCents(s.pool.returnedCents)],
      ["= Rest-Kassenbestand (Ende)", formatCents(s.pool.closingCents)],
    ]);
    w.y -= 8;
    w.line("Ausgaben", { size: 11, bold: true });
    w.table([{ title: "Position", width: 330 }, { title: "Betrag", width: width - 330, align: "right" }], [
      ["Belegte Ausgaben", formatCents(s.totals.receiptsCents)],
      ["Manuelle Ausgleiche (ohne Beleg)", formatCents(s.totals.adjustmentsCents)],
      ["Offene Mitarbeiter-Budgets (Ende)", formatCents(s.totals.walletsOpenCents)],
      ["Offene Auslagen-Ansprüche (Ende)", formatCents(s.totals.claimsOpenCents)],
    ]);
    w.y -= 8;
  }

  w.line(employeeView ? "Mein Konto" : "Mitarbeiterkonten (Budget und Auslagen)", { size: 11, bold: true });
  w.table(
    [
      { title: "Mitarbeiter", width: 90 }, { title: "Budget Anfang", width: 62, align: "right" },
      { title: "Erhalten", width: 54, align: "right" }, { title: "Belege", width: 50, align: "right" },
      { title: "Budget Ende", width: 62, align: "right" }, { title: "Anspruch", width: 62, align: "right" },
      { title: "Saldo vs. Firma", width: width - 380, align: "right" },
    ],
    s.employees.map((e) => [e.name, formatCents(e.openingCents), formatCents(e.allocatedCents), formatCents(e.receiptsCents),
      formatCents(e.closingCents), formatCents(e.claimClosingCents), formatCents(e.firmBalanceCents)]),
    8,
  );
  if (s.partners?.length) {
    w.y -= 8;
    w.line("Gesellschafter: Vorgelegtes Geld (Auslagen) und Budget – getrennt vom Kapitalkonto", { size: 11, bold: true });
    w.table(
      [
        { title: "Gesellschafter", width: 110 }, { title: "Auslagen Anfang", width: 70, align: "right" },
        { title: "+ Vorgelegt", width: 62, align: "right" }, { title: "– Erstattet", width: 62, align: "right" },
        { title: "Offen Ende", width: 66, align: "right" }, { title: "Budget Ende", width: 62, align: "right" },
        { title: "Firmenmittel", width: width - 432, align: "right" },
      ],
      s.partners.map((p) => [p.name, formatCents(p.outlayOpeningCents), formatCents(p.outlayCents), formatCents(p.refundCents),
        formatCents(p.outlayClosingCents), formatCents(p.budgetClosingCents), formatCents(p.expenseCents)]),
      8,
    );
    w.y -= 8;
    w.line("Gesellschafter-Kapitalkonten", { size: 11, bold: true });
    w.table(
      [
        { title: "Gesellschafter", width: 140 }, { title: "Übertrag", width: 80, align: "right" },
        { title: "Einlagen", width: 80, align: "right" }, { title: "Entnahmen", width: 80, align: "right" },
        { title: "Gewinn", width: 70, align: "right" }, { title: "Ende", width: width - 450, align: "right" },
      ],
      s.partners.map((p) => [p.name, formatCents(p.openingCents), formatCents(p.depositCents), formatCents(p.drawCents), formatCents(p.profitCents), formatCents(p.closingCents)]),
      8,
    );
  }
  if (partnerBookings.length) {
    w.y -= 8;
    w.line(`Gesellschafter-Buchungen (${partnerBookings.length}) – Mittelherkunft, Zweck und Erstattungsstatus`, { size: 11, bold: true });
    w.tableOpen(
      [
        { title: "Datum", width: 50 }, { title: "Person", width: 56 }, { title: "Vorgang", width: 86 },
        { title: "Herkunft / Konto", width: 62 }, { title: "Betrag", width: 54, align: "right" },
        { title: "Wofür? / Begründung", width: 100 }, { title: "Status", width: width - 408 },
      ],
      partnerBookingTableRows(partnerBookings),
      7.5,
    );
  }
  w.y -= 8;
  w.line(`Einzelbuchungen (${rows.length})`, { size: 11, bold: true });
  w.table(
    [
      { title: "Datum", width: 62 }, { title: "Art", width: 88 }, { title: "Person", width: 70 },
      { title: "Konto", width: 40 }, { title: "Beschreibung", width: 120 },
      { title: "Kasse", width: 52, align: "right" as const },
      { title: "Bank", width: 52, align: "right" as const },
    ],
    [...rows].reverse().map((r) => [
      fmtDateTime(r.bookingDate), typeLabel(r), r.employeeName ?? "–",
      r.accountKind === "BANK" ? "Bank" : r.accountKind === "CASH" ? "Bar" : "",
      [r.description, r.invoiceNumber].filter(Boolean).join(" · "),
      r.cashDeltaCents ? formatCents(r.cashDeltaCents) : "",
      r.bankDeltaCents ? formatCents(r.bankDeltaCents) : "",
    ]),
    8,
  );
  w.footerOnAllPages(`${tenantName} · ${title} · erstellt ${fmtDateTime(new Date())}`);
  return w.save();
}

export async function exportReport(ctx: Ctx, format: "csv" | "pdf", from: string, to: string, employeeId?: string) {
  requireRole(ctx, "ADMIN", "EMPLOYEE", "PARTNER");
  if (ctx.role === "PARTNER" && !ctx.canViewReports) throw forbidden("Kein Zugriff auf Berichte");
  const tenantId = tid(ctx);
  const range = rangeFromDays(from, to);
  const only = ctx.role === "ADMIN" || (ctx.role === "PARTNER" && ctx.canViewReports) ? employeeId : ctx.userId;
  const { rows, summary, tenantName, partnerBookings } = await withTenant(ctx, async (tx) => ({
    rows: await ledgerRows(tx, tenantId, { range, employeeId: only, limit: 100_000 }),
    summary: await buildSummary(tx, tenantId, range, from, to, only),
    partnerBookings: ctx.role === "EMPLOYEE" || (only && ctx.role === "ADMIN")
      ? []
      : await partnerBookingRows(tx, tenantId, { range, partnerId: only }),
    tenantName: (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { name: true } }))!.name,
  }));
  const base = `protokoll_${from}_${to}`;
  if (format === "csv") {
    return { filename: `${base}.csv`, mime: "text/csv; charset=utf-8", data: Buffer.from(toCsv(rows, partnerBookings), "utf-8") };
  }
  const title = ctx.role === "EMPLOYEE" ? `Kontoprotokoll ${ctx.name}` : "Einnahmen- & Ausgabenprotokoll";
  const data = await renderReportPdf(tenantName, summary, rows, title, ctx.role === "EMPLOYEE", partnerBookings);
  return { filename: `${base}.pdf`, mime: "application/pdf", data: Buffer.from(data) };
}
