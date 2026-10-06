// Modul A: Rechnungen lesen, Entwürfe anlegen/bearbeiten/löschen
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/infrastructure/db/client";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { contacts, invoiceItems, invoices, ledgerEntries, tenants } from "@/infrastructure/db/schema";
import { notFound, rule } from "@/domain/errors";
import { calcInvoice, canEdit, displayStatus, type DisplayStatus } from "@/domain/invoice";
import { dateInputToDate, dayRange, todayKey } from "@/domain/period";
import { invoiceDraftSchema, invoiceDraftUpdateSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import { audit } from "../ledger-service";

export async function listInvoices(ctx: Ctx, f: { status?: DisplayStatus; contactId?: string; q?: string } = {}) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const startToday = dayRange(todayKey()).start;
  const statusFilter =
    f.status === "OVERDUE" ? and(eq(invoices.status, "OPEN"), lt(invoices.dueDate, startToday))
    : f.status ? eq(invoices.status, f.status) : undefined;
  return withTenant(ctx, async (tx) => {
    const rows = await tx.select({
      id: invoices.id, number: invoices.number, status: invoices.status, issueDate: invoices.issueDate,
      dueDate: invoices.dueDate, paidAt: invoices.paidAt, grossCents: invoices.grossCents,
      cancelsInvoiceId: invoices.cancelsInvoiceId, createdAt: invoices.createdAt,
      contactId: invoices.contactId, contactName: contacts.name,
    }).from(invoices)
      .innerJoin(contacts, eq(contacts.id, invoices.contactId))
      .where(and(
        eq(invoices.tenantId, tenantId), statusFilter,
        f.contactId ? eq(invoices.contactId, f.contactId) : undefined,
        f.q ? or(ilike(invoices.number, `%${f.q}%`), ilike(contacts.name, `%${f.q}%`)) : undefined,
      ))
      .orderBy(desc(invoices.createdAt))
      .limit(500);
    return rows.map((r) => ({ ...r, displayStatus: displayStatus(r.status, r.dueDate) }));
  });
}

export async function loadInvoiceFull(tx: Tx, tenantId: string, id: string) {
  const inv = await tx.query.invoices.findFirst({ where: and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)) });
  if (!inv) throw notFound("Rechnung");
  // Nacheinander: eine Transaktion = eine DB-Verbindung, keine parallelen Queries
  const items = await tx.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.position));
  const contact = await tx.query.contacts.findFirst({ where: eq(contacts.id, inv.contactId) });
  const canceledBy = await tx.query.invoices.findFirst({ where: eq(invoices.cancelsInvoiceId, id), columns: { id: true, number: true } });
  const cancels = inv.cancelsInvoiceId
    ? await tx.query.invoices.findFirst({ where: eq(invoices.id, inv.cancelsInvoiceId), columns: { id: true, number: true } })
    : undefined;
  const income = await tx.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.invoiceId, id) });
  return {
    ...inv, items, contact: contact!, canceledBy: canceledBy ?? null, cancels: cancels ?? null,
    incomeEntryId: income?.id ?? null, displayStatus: displayStatus(inv.status, inv.dueDate),
  };
}

export async function getInvoice(ctx: Ctx, id: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, (tx) => loadInvoiceFull(tx, tenantId, id));
}

async function assertContact(tx: Tx, tenantId: string, contactId: string) {
  const c = await tx.query.contacts.findFirst({ where: and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)) });
  if (!c) throw notFound("Kontakt");
  if (c.archived) throw rule("Kontakt ist archiviert");
}

async function writeItems(tx: Tx, tenantId: string, invoiceId: string, items: z.infer<typeof invoiceDraftSchema>["items"]) {
  const t = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { smallBusiness: true } });
  const calc = calcInvoice(items, t!.smallBusiness);
  await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
  if (calc.items.length) {
    await tx.insert(invoiceItems).values(calc.items.map((i) => ({ ...i, invoiceId })));
  }
  await tx.update(invoices).set({ netCents: calc.netCents, vatCents: calc.vatCents, grossCents: calc.grossCents })
    .where(eq(invoices.id, invoiceId));
}

export async function createDraft(ctx: Ctx, input: z.infer<typeof invoiceDraftSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await assertContact(tx, tenantId, input.contactId);
    const [inv] = await tx.insert(invoices).values({
      tenantId, contactId: input.contactId, notes: input.notes,
      serviceDate: input.serviceDate ? dateInputToDate(input.serviceDate) : null,
      dueDate: input.dueDate ? dateInputToDate(input.dueDate) : null,
    }).returning();
    await writeItems(tx, tenantId, inv.id, input.items);
    await audit(tx, ctx, "invoice.draft_created", "Invoice", inv.id);
    return loadInvoiceFull(tx, tenantId, inv.id);
  });
}

export async function updateDraft(ctx: Ctx, id: string, input: z.infer<typeof invoiceDraftUpdateSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const [inv] = await tx.select().from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).for("update");
    if (!inv) throw notFound("Rechnung");
    if (!canEdit(inv.status)) throw rule("Nur Entwürfe können bearbeitet werden");
    if (input.contactId) await assertContact(tx, tenantId, input.contactId);
    const patch: Partial<typeof invoices.$inferInsert> = {};
    if (input.contactId) patch.contactId = input.contactId;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.serviceDate !== undefined) patch.serviceDate = input.serviceDate ? dateInputToDate(input.serviceDate) : null;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate ? dateInputToDate(input.dueDate) : null;
    if (Object.keys(patch).length) await tx.update(invoices).set(patch).where(eq(invoices.id, id));
    if (input.items) await writeItems(tx, tenantId, id, input.items);
    return loadInvoiceFull(tx, tenantId, id);
  });
}

/** Entwürfe haben noch keine Nummer -> dürfen gelöscht werden */
export async function deleteDraft(ctx: Ctx, id: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const [inv] = await tx.select().from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).for("update");
    if (!inv) throw notFound("Rechnung");
    if (inv.status !== "DRAFT") throw rule("Nur Entwürfe können gelöscht werden – sonst stornieren");
    await tx.delete(invoices).where(eq(invoices.id, id));
    await audit(tx, ctx, "invoice.draft_deleted", "Invoice", id);
  });
}

/** Summen offener / überfälliger Rechnungen fürs Dashboard */
export async function invoiceStats(tx: Tx, tenantId: string) {
  const startToday = dayRange(todayKey()).start;
  const [r] = await tx.select({
    openCount: sql<number>`count(*) filter (where ${invoices.status} = 'OPEN')::int`,
    openCents: sql<string>`coalesce(sum(${invoices.grossCents}) filter (where ${invoices.status} = 'OPEN'), 0)::bigint`,
    overdueCount: sql<number>`count(*) filter (where ${invoices.status} = 'OPEN' and ${invoices.dueDate} < ${startToday})::int`,
    overdueCents: sql<string>`coalesce(sum(${invoices.grossCents}) filter (where ${invoices.status} = 'OPEN' and ${invoices.dueDate} < ${startToday}), 0)::bigint`,
    draftCount: sql<number>`count(*) filter (where ${invoices.status} = 'DRAFT')::int`,
  }).from(invoices).where(and(eq(invoices.tenantId, tenantId), inArray(invoices.status, ["OPEN", "DRAFT"])));
  return {
    openCount: r.openCount, openCents: Number(r.openCents),
    overdueCount: r.overdueCount, overdueCents: Number(r.overdueCents), draftCount: r.draftCount,
  };
}
