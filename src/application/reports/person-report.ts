// Einzelberichte je Mitarbeiter / Gesellschafter (Web + PDF)
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/infrastructure/db/client";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { tenants, users } from "@/infrastructure/db/schema";
import { PdfWriter, A4, MARGIN } from "@/infrastructure/pdf/pdf-kit";
import { forbidden, notFound } from "@/domain/errors";
import { formatCents } from "@/domain/money";
import { fmtDate, fmtDateTime } from "@/domain/period";
import { buildPersonReport, type PersonReport, type PersonRole } from "@/domain/person-report";
import { FUNDING_LABEL, PARTNER_KIND_LABEL, REFUND_STATUS_LABEL } from "@/domain/partner";
import { requireRole, tid, type Ctx } from "../context";
import { claimBalance, partnerBalance, walletBalance } from "../ledger-service";
import { partnerBookingRows, type PartnerBookingRow } from "../partners/partner-bookings";
import { ledgerRows, rangeFromDays } from "./reports";

export type FullPersonReport = PersonReport & { partnerBookings: PartnerBookingRow[] };

export async function buildPersonReportTx(
  tx: Tx, tenantId: string, person: { id: string; name: string; role: PersonRole }, from: string, to: string,
): Promise<FullPersonReport> {
  const range = rangeFromDays(from, to);
  const rows = await ledgerRows(tx, tenantId, { range, employeeId: person.id, limit: 100_000 });
  const report = buildPersonReport({
    person, from, to, rows,
    opening: {
      walletCents: await walletBalance(tx, tenantId, person.id, range.start),
      claimCents: await claimBalance(tx, tenantId, person.id, range.start),
      capitalCents: person.role === "PARTNER" ? await partnerBalance(tx, tenantId, person.id, range.start) : 0,
    },
  });
  const partnerBookings = person.role === "PARTNER" ? await partnerBookingRows(tx, tenantId, { partnerId: person.id, range }) : [];
  return { ...report, partnerBookings };
}

async function loadPerson(tx: Tx, tenantId: string, personId: string) {
  const u = await tx.query.users.findFirst({
    where: and(eq(users.id, personId), eq(users.tenantId, tenantId), inArray(users.role, ["EMPLOYEE", "PARTNER"])),
  });
  if (!u) throw notFound("Person");
  return { id: u.id, name: u.name, role: u.role as PersonRole };
}

/** Admin: jede Person. Mitarbeiter / Gesellschafter: nur der eigene Bericht. */
export async function getPersonReport(ctx: Ctx, personId: string, from: string, to: string) {
  requireRole(ctx, "ADMIN", "EMPLOYEE", "PARTNER");
  if (ctx.role !== "ADMIN" && personId !== ctx.userId) throw forbidden("Nur der eigene Bericht ist einsehbar");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => buildPersonReportTx(tx, tenantId, await loadPerson(tx, tenantId, personId), from, to));
}

/** Admin: Übersicht – je Person ein eigener Bericht (keine Sammeltabelle) */
export async function listPersonReports(ctx: Ctx, from: string, to: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const people = await tx.select({ id: users.id, name: users.name, role: users.role }).from(users)
      .where(and(eq(users.tenantId, tenantId), inArray(users.role, ["EMPLOYEE", "PARTNER"])))
      .orderBy(asc(users.role), asc(users.name));
    const out: FullPersonReport[] = [];
    for (const p of people) out.push(await buildPersonReportTx(tx, tenantId, { ...p, role: p.role as PersonRole }, from, to));
    return out;
  });
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
  if (b.kind === "PURCHASE_CAPITAL") return "Betriebsausgabe – vom Kapitalkonto abgezogen";
  if (b.kind === "PURCHASE_BUDGET") return "Betriebsausgabe – vom Budget abgezogen";
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

const ROLE_LABEL: Record<PersonRole, string> = { EMPLOYEE: "Mitarbeiter", PARTNER: "Gesellschafter" };

/** Abschnitt eines Einzelberichts – beginnt immer auf einer neuen Seite (außer als erster Inhalt) */
export function drawPersonReport(w: PdfWriter, r: FullPersonReport, opts: { newPage?: boolean } = {}) {
  const width = A4.w - 2 * MARGIN;
  if (opts.newPage) w.newPage();
  w.line(`Einzelbericht ${r.person.name}`, { size: 15, bold: true });
  w.line(`${ROLE_LABEL[r.person.role]}   ·   Zeitraum ${fmtDate(new Date(r.from + "T12:00:00Z"))} – ${fmtDate(new Date(r.to + "T12:00:00Z"))}`, { size: 9 });
  w.hr();

  w.line("Ergebnis", { size: 11, bold: true });
  for (const s of r.statements) w.paragraph(`• ${s}`, width, { size: 9 });
  w.y -= 6;

  for (const a of r.accounts) {
    w.line(a.title, { size: 11, bold: true });
    w.line(a.hint, { size: 8 });
    const rows: string[][] = [
      ["Anfangsbestand (Übertrag)", formatCents(a.openingCents)],
      ...a.lines.map((l) => [l.label, formatCents(l.label.startsWith("−") ? Math.abs(l.cents) : l.cents)]),
      [`= ${a.closingLabel}`, formatCents(a.closingCents)],
    ];
    if (a.firmViewCents !== null) rows.push([`Sicht der Firma: ${a.firmViewLabel}`, formatCents(a.firmViewCents)]);
    w.tableOpen([{ title: "Position", width: width - 130 }, { title: "Betrag", width: 130, align: "right" }], rows, 8.5);
    w.y -= 18;
  }

  w.line(`Geldtransfers Kasse / Bankkonto (${r.transfers.length})`, { size: 11, bold: true });
  if (!r.transfers.length) w.line("Keine Transfers im Zeitraum.", { size: 8.5 });
  else {
    w.tableOpen(
      [
        { title: "Datum", width: 52 }, { title: "Richtung", width: 92 }, { title: "Konto", width: 62 },
        { title: "Betrag", width: 62, align: "right" }, { title: "Vorgang", width: 80 }, { title: "Verwendungszweck", width: width - 348 },
      ],
      r.transfers.map((t) => [
        fmtDate(t.date), t.directionLabel, t.accountLabel, formatCents(t.amountCents),
        `${t.kind}${t.reversed ? " (storniert)" : ""}`, t.purpose,
      ]),
      7.5,
    );
  }
  w.y -= 18;

  if (r.partnerBookings.length) {
    w.line(`Gesellschafter-Buchungen (${r.partnerBookings.length}) – Herkunft, Zweck, Erstattungsstatus`, { size: 11, bold: true });
    w.tableOpen(
      [
        { title: "Datum", width: 50 }, { title: "Vorgang", width: 92 }, { title: "Herkunft / Konto", width: 72 },
        { title: "Betrag", width: 58, align: "right" }, { title: "Wofür? / Begründung", width: 110 }, { title: "Status", width: width - 382 },
      ],
      partnerBookingTableRows(r.partnerBookings).map(([d, , k, src, amt, why, st]) => [d, k, src, amt, why, st]),
      7.5,
    );
    w.y -= 18;
  }

  w.line(`Alle Bewegungen (${r.movements.length})`, { size: 11, bold: true });
  if (!r.movements.length) w.line("Keine Bewegungen im Zeitraum.", { size: 8.5 });
  else {
    w.tableOpen(
      [
        { title: "Datum", width: 52 }, { title: "Vorgang", width: 88 }, { title: "Konto", width: 52 },
        { title: "Betrag", width: 60, align: "right" }, { title: "Saldo danach", width: 62, align: "right" },
        { title: "Zweck / Herkunft", width: width - 314 },
      ],
      r.movements.map((m) => [
        fmtDate(m.date), `${m.kind}${m.reversed ? " (storniert)" : ""}`, m.accountLabel, formatCents(m.deltaCents),
        m.balanceAfterCents === null ? "–" : formatCents(m.balanceAfterCents),
        [m.purpose, m.via && `über ${m.via}`].filter(Boolean).join(" · "),
      ]),
      7.5,
    );
  }
}

export async function exportPersonReport(ctx: Ctx, personId: string, from: string, to: string) {
  const report = await getPersonReport(ctx, personId, from, to);
  const tenantName = await withTenant(ctx, async (tx) =>
    (await tx.query.tenants.findFirst({ where: eq(tenants.id, tid(ctx)), columns: { name: true } }))!.name);
  const w = await PdfWriter.create();
  drawPersonReport(w, report);
  w.footerOnAllPages(`${tenantName} · Einzelbericht ${report.person.name} · erstellt ${fmtDateTime(new Date())}`);
  const slug = report.person.name.normalize("NFKD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "person";
  return { filename: `bericht_${slug}_${from}_${to}.pdf`, data: Buffer.from(await w.save()) };
}
