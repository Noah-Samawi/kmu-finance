// Modul D: Export für den Steuerberater (CSV + PDF)
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/infrastructure/db/client";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { tenants, users } from "@/infrastructure/db/schema";
import { PdfWriter, A4, MARGIN } from "@/infrastructure/pdf/pdf-kit";
import { LEDGER_LABEL } from "@/domain/ledger";
import { centsToPlain, formatCents } from "@/domain/money";
import { fmtDate, fmtDateTime } from "@/domain/period";
import { forbidden } from "@/domain/errors";
import { requireRole, tid, type Ctx } from "../context";
import { buildSummary, ledgerRows, rangeFromDays, type LedgerRow, type Summary } from "./reports";
import { partnerBookingRows, type PartnerBookingRow } from "../partners/partner-bookings";
import { FUNDING_LABEL, PARTNER_KIND_LABEL } from "@/domain/partner";
import type { PersonRole } from "@/domain/person-report";
import { buildPersonReportTx, drawPersonReport, partnerStatusText, type FullPersonReport } from "./person-report";

export { partnerBookingTableRows, partnerStatusText } from "./person-report";

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

/**
 * Firmenbericht: Kasse/Bank, Pool, Ausgaben, Journal – danach je Person ein eigener
 * Einzelbericht auf eigener Seite (keine Sammeltabellen über mehrere Personen).
 */
export async function renderReportPdf(
  tenantName: string, s: Summary, rows: LedgerRow[], title: string, employeeView: boolean, persons: FullPersonReport[] = [],
) {
  const w = await PdfWriter.create();
  const width = A4.w - 2 * MARGIN;
  w.line(title, { size: 16, bold: true });
  w.line(`${tenantName}   ·   Zeitraum ${fmtDate(new Date(s.from + "T12:00:00Z"))} – ${fmtDate(new Date(s.to + "T12:00:00Z"))}`, { size: 9 });
  w.hr();

  if (employeeView) {
    persons.forEach((p, i) => drawPersonReport(w, p, { newPage: i > 0 }));
    w.footerOnAllPages(`${tenantName} · ${title} · erstellt ${fmtDateTime(new Date())}`);
    return w.save();
  }
  {
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
    w.y -= 18;
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
    ]);
    w.y -= 8;
    w.paragraph(
      `Personenkonten (Budget, Auslagen, Kapital) stehen in den Einzelberichten ab Seite 2 – je Person ein eigener Bericht${persons.length ? `: ${persons.map((p) => p.person.name).join(", ")}` : ""}.`,
      width, { size: 8.5 },
    );
    w.y -= 4;
  }

  const journal = rows.filter((r) => r.cashDeltaCents || r.bankDeltaCents);
  w.y -= 8;
  w.line(`Journal Kasse / Bank (${journal.length} Bewegungen)`, { size: 11, bold: true });
  w.line("Nur Geldbewegungen der Firmenkonten – Budget-, Beleg- und Auslagenbuchungen je Person stehen im Einzelbericht.", { size: 8 });
  w.table(
    [
      { title: "Datum", width: 62 }, { title: "Art", width: 88 }, { title: "Person", width: 70 },
      { title: "Konto", width: 40 }, { title: "Beschreibung", width: 120 },
      { title: "Kasse", width: 52, align: "right" as const },
      { title: "Bank", width: 52, align: "right" as const },
    ],
    [...journal].reverse().map((r) => [
      fmtDateTime(r.bookingDate), typeLabel(r), r.employeeName ?? "–",
      r.accountKind === "BANK" ? "Bank" : r.accountKind === "CASH" ? "Bar" : "",
      [r.description, r.invoiceNumber].filter(Boolean).join(" · "),
      r.cashDeltaCents ? formatCents(r.cashDeltaCents) : "",
      r.bankDeltaCents ? formatCents(r.bankDeltaCents) : "",
    ]),
    8,
  );
  persons.forEach((p) => drawPersonReport(w, p, { newPage: true }));
  w.footerOnAllPages(`${tenantName} · ${title} · erstellt ${fmtDateTime(new Date())}`);
  return w.save();
}

export async function exportReport(ctx: Ctx, format: "csv" | "pdf", from: string, to: string, employeeId?: string) {
  requireRole(ctx, "ADMIN", "EMPLOYEE", "PARTNER");
  if (ctx.role === "PARTNER" && !ctx.canViewReports) throw forbidden("Kein Zugriff auf Berichte");
  const tenantId = tid(ctx);
  const range = rangeFromDays(from, to);
  const only = ctx.role === "ADMIN" || (ctx.role === "PARTNER" && ctx.canViewReports) ? employeeId : ctx.userId;
  const { rows, summary, tenantName, partnerBookings, persons } = await withTenant(ctx, async (tx) => ({
    rows: await ledgerRows(tx, tenantId, { range, employeeId: only, limit: 100_000 }),
    summary: await buildSummary(tx, tenantId, range, from, to, only),
    partnerBookings: ctx.role === "EMPLOYEE" || (only && ctx.role === "ADMIN")
      ? []
      : await partnerBookingRows(tx, tenantId, { range, partnerId: only }),
    persons: await personsFor(tx, tenantId, only, from, to),
    tenantName: (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { name: true } }))!.name,
  }));
  const base = `protokoll_${from}_${to}`;
  if (format === "csv") {
    return { filename: `${base}.csv`, mime: "text/csv; charset=utf-8", data: Buffer.from(toCsv(rows, partnerBookings), "utf-8") };
  }
  const title = ctx.role === "EMPLOYEE" ? `Kontoprotokoll ${ctx.name}` : "Einnahmen- & Ausgabenprotokoll";
  const data = await renderReportPdf(tenantName, summary, rows, title, ctx.role === "EMPLOYEE", persons);
  return { filename: `${base}.pdf`, mime: "application/pdf", data: Buffer.from(data) };
}

async function personsFor(tx: Tx, tenantId: string, only: string | undefined, from: string, to: string) {
  const people = await tx.select({ id: users.id, name: users.name, role: users.role }).from(users)
    .where(and(
      eq(users.tenantId, tenantId), inArray(users.role, ["EMPLOYEE", "PARTNER"]),
      only ? eq(users.id, only) : undefined,
    ))
    .orderBy(asc(users.role), asc(users.name));
  const out: FullPersonReport[] = [];
  for (const p of people) out.push(await buildPersonReportTx(tx, tenantId, { ...p, role: p.role as PersonRole }, from, to));
  return out;
}
