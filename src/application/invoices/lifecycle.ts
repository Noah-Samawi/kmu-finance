// Modul A: Statusübergänge  DRAFT -> OPEN -> PAID / CANCELED
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/infrastructure/db/client";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { contacts, invoiceItems, invoices, ledgerEntries, tenants } from "@/infrastructure/db/schema";
import { storage } from "@/infrastructure/storage/local";
import { renderInvoicePdf, type InvoicePdfData } from "@/infrastructure/pdf/invoice-pdf";
import { notFound, rule } from "@/domain/errors";
import { canCancel, canIssue, canMarkPaid, formatInvoiceNumber } from "@/domain/invoice";
import { deltasFor, reversalDeltas } from "@/domain/ledger";
import { addDays, dateInputToDate, todayKey } from "@/domain/period";
import { requireRole, tid, type Ctx } from "../context";
import { audit, insertEntry, insufficient, poolBalance } from "../ledger-service";
import { loadInvoiceFull } from "./drafts";

type Snapshot = { issuer: InvoicePdfData["issuer"]; recipient: InvoicePdfData["recipient"] };

async function lockInvoice(tx: Tx, tenantId: string, id: string) {
  const [inv] = await tx.select().from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).for("update");
  if (!inv) throw notFound("Rechnung");
  return inv;
}

/** Lückenlose, fortlaufende Nummer je Mandant und Jahr (atomar) */
async function nextInvoiceNumber(tx: Tx, tenantId: string, prefix: string, year: number) {
  const r = await tx.execute<{ n: number }>(sql`
    insert into "InvoiceSequence" ("tenantId", "year", "next") values (${tenantId}, ${year}, 2)
    on conflict ("tenantId", "year") do update set "next" = "InvoiceSequence"."next" + 1
    returning "next" - 1 as n`);
  return formatInvoiceNumber(prefix, year, Number(r.rows[0].n));
}

async function storePdf(tenantId: string, number: string, data: InvoicePdfData) {
  const key = `${tenantId}/invoices/${number}.pdf`;
  await storage.put(key, await renderInvoicePdf(data));
  return key;
}

/** DRAFT -> OPEN: Nummer vergeben, Daten einfrieren, PDF archivieren */
export async function issueInvoice(ctx: Ctx, id: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const inv = await lockInvoice(tx, tenantId, id);
    if (!canIssue(inv.status)) throw rule("Rechnung wurde bereits ausgestellt");
    const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.position));
    if (!items.length) throw rule("Rechnung hat keine Positionen");
    if (inv.grossCents <= 0) throw rule("Rechnungsbetrag muss größer als 0 sein");

    const t = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
    const c = (await tx.query.contacts.findFirst({ where: eq(contacts.id, inv.contactId) }))!;
    const now = new Date();
    const number = await nextInvoiceNumber(tx, tenantId, t.invoicePrefix, Number(todayKey(now).slice(0, 4)));
    const issueDate = dateInputToDate(todayKey(now));
    const serviceDate = inv.serviceDate ?? issueDate;
    const dueDate = inv.dueDate && inv.dueDate >= issueDate ? inv.dueDate : addDays(issueDate, t.defaultPaymentDays);
    const snapshot: Snapshot = {
      issuer: {
        legalName: t.legalName, street: t.street, zip: t.zip, city: t.city, taxNumber: t.taxNumber,
        vatId: t.vatId, iban: t.iban, bic: t.bic, smallBusiness: t.smallBusiness,
      },
      recipient: { name: c.name, street: c.street, zip: c.zip, city: c.city, vatId: c.vatId },
    };
    const pdfKey = await storePdf(tenantId, number, {
      ...snapshot, number, isDraft: false, isCancellation: false, issueDate, serviceDate, dueDate,
      notes: inv.notes, items, netCents: inv.netCents, vatCents: inv.vatCents, grossCents: inv.grossCents,
    });
    await tx.update(invoices).set({
      status: "OPEN", number, issueDate, serviceDate, dueDate, recipientSnapshot: snapshot, pdfKey,
    }).where(eq(invoices.id, id));
    await audit(tx, ctx, "invoice.issued", "Invoice", id, { number });
    return loadInvoiceFull(tx, tenantId, id);
  });
}

/**
 * OPEN -> PAID. Der Bruttobetrag fließt automatisch in den Einnahmen-Pool.
 * ledgerEntries.invoiceId ist UNIQUE -> Doppelbuchung technisch unmöglich.
 */
export async function markInvoicePaid(ctx: Ctx, id: string, paidAtInput?: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const paidAt = paidAtInput ? dateInputToDate(paidAtInput) : new Date();
  if (paidAtInput && paidAtInput > todayKey()) throw rule("Zahlungsdatum darf nicht in der Zukunft liegen");
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const inv = await lockInvoice(tx, tenantId, id);
    if (!canMarkPaid(inv.status)) throw rule("Nur offene Rechnungen können als bezahlt markiert werden");
    await tx.update(invoices).set({ status: "PAID", paidAt }).where(eq(invoices.id, id));
    await insertEntry(tx, ctx, tenantId, {
      type: "INCOME_INVOICE", ...deltasFor("INCOME_INVOICE", inv.grossCents),
      invoiceId: id, bookingDate: paidAt, description: `Zahlungseingang ${inv.number}`,
    });
    await audit(tx, ctx, "invoice.paid", "Invoice", id, { grossCents: inv.grossCents });
    return loadInvoiceFull(tx, tenantId, id);
  });
}

/**
 * Storno (GoBD: Rechnungen werden nie gelöscht).
 * Erzeugt eine Stornorechnung mit eigener Nummer und negativen Beträgen.
 * War die Rechnung bezahlt, wird die Einnahme aus dem Pool zurückgebucht –
 * das geht nur, wenn der Betrag noch frei im Pool liegt (kein Minus).
 */
export async function cancelInvoice(ctx: Ctx, id: string, reason: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const inv = await lockInvoice(tx, tenantId, id);
    if (inv.cancelsInvoiceId) throw rule("Eine Stornorechnung kann nicht storniert werden");
    if (!canCancel(inv.status)) throw rule("Nur offene oder bezahlte Rechnungen können storniert werden");

    if (inv.status === "PAID") {
      const income = await tx.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.invoiceId, id) });
      if (income) {
        const pool = await poolBalance(tx, tenantId);
        if (pool < inv.grossCents) {
          throw insufficient("Freier Kassenbestand für die Rückbuchung (Budget erst zurückführen)", pool);
        }
        await insertEntry(tx, ctx, tenantId, {
          type: "REVERSAL", ...reversalDeltas(income), reversalOfId: income.id,
          description: `Storno Zahlungseingang ${inv.number}: ${reason}`,
        });
      }
    }

    const t = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
    const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.position));
    const now = new Date();
    const number = await nextInvoiceNumber(tx, tenantId, t.invoicePrefix, Number(todayKey(now).slice(0, 4)));
    const issueDate = dateInputToDate(todayKey(now));
    const snapshot = inv.recipientSnapshot as Snapshot;
    const negItems = items.map((i) => ({
      position: i.position, description: i.description, quantity: i.quantity, unit: i.unit,
      unitPriceCents: -i.unitPriceCents, vatRate: i.vatRate,
      lineNetCents: -i.lineNetCents, lineVatCents: -i.lineVatCents,
    }));
    const notes = `Storno der Rechnung ${inv.number}. Grund: ${reason}`;
    const pdfKey = await storePdf(tenantId, number, {
      ...snapshot, number, isDraft: false, isCancellation: true, cancelsNumber: inv.number,
      issueDate, serviceDate: inv.serviceDate, dueDate: null, notes, items: negItems,
      netCents: -inv.netCents, vatCents: -inv.vatCents, grossCents: -inv.grossCents,
    });
    const [storno] = await tx.insert(invoices).values({
      tenantId, contactId: inv.contactId, number, status: "CANCELED", issueDate,
      serviceDate: inv.serviceDate, recipientSnapshot: snapshot, notes, pdfKey,
      netCents: -inv.netCents, vatCents: -inv.vatCents, grossCents: -inv.grossCents,
      cancelsInvoiceId: inv.id,
    }).returning();
    if (negItems.length) await tx.insert(invoiceItems).values(negItems.map((i) => ({ ...i, invoiceId: storno.id })));
    await tx.update(invoices).set({ status: "CANCELED" }).where(eq(invoices.id, id));
    await audit(tx, ctx, "invoice.canceled", "Invoice", id, { stornoId: storno.id, stornoNumber: number, reason });
    return loadInvoiceFull(tx, tenantId, id);
  });
}

/** Archiviertes PDF ausliefern; für Entwürfe eine Vorschau erzeugen */
export async function getInvoicePdf(ctx: Ctx, id: string): Promise<{ filename: string; data: Uint8Array }> {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const inv = await withTenant(ctx, (tx) => loadInvoiceFull(tx, tenantId, id));
  if (inv.pdfKey) return { filename: `${inv.number}.pdf`, data: await storage.get(inv.pdfKey) };
  const t = await withTenant(ctx, (tx) => tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }));
  const data = await renderInvoicePdf({
    number: null, isDraft: true, isCancellation: false, issueDate: new Date(),
    serviceDate: inv.serviceDate, dueDate: inv.dueDate, notes: inv.notes, items: inv.items,
    issuer: { ...t!, smallBusiness: t!.smallBusiness },
    recipient: inv.contact, netCents: inv.netCents, vatCents: inv.vatCents, grossCents: inv.grossCents,
  });
  return { filename: `Entwurf-${inv.id.slice(0, 8)}.pdf`, data };
}
