// Modul A: Stammkunden / Lieferanten
import { and, asc, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { contacts, invoices } from "@/infrastructure/db/schema";
import { notFound } from "@/domain/errors";
import { displayStatus } from "@/domain/invoice";
import { contactSchema, contactUpdateSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import { audit } from "../ledger-service";

export async function listContacts(ctx: Ctx, opts: { q?: string; includeArchived?: boolean } = {}) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, (tx) =>
    tx.select().from(contacts).where(and(
      eq(contacts.tenantId, tenantId),
      opts.includeArchived ? undefined : eq(contacts.archived, false),
      opts.q ? ilike(contacts.name, `%${opts.q.replace(/[%_]/g, "")}%`) : undefined,
    )).orderBy(asc(contacts.name)),
  );
}

/** Kontakt + vollständige Rechnungshistorie mit Status */
export async function getContact(ctx: Ctx, id: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const c = await tx.query.contacts.findFirst({ where: and(eq(contacts.id, id), eq(contacts.tenantId, tenantId)) });
    if (!c) throw notFound("Kontakt");
    const inv = await tx.select({
      id: invoices.id, number: invoices.number, status: invoices.status, issueDate: invoices.issueDate,
      dueDate: invoices.dueDate, paidAt: invoices.paidAt, grossCents: invoices.grossCents,
      cancelsInvoiceId: invoices.cancelsInvoiceId, createdAt: invoices.createdAt,
    }).from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.contactId, id)))
      .orderBy(desc(invoices.createdAt));
    const history = inv.map((i) => ({ ...i, displayStatus: displayStatus(i.status, i.dueDate) }));
    const stats = {
      openCents: history.filter((i) => i.status === "OPEN").reduce((s, i) => s + i.grossCents, 0),
      paidCents: history.filter((i) => i.status === "PAID").reduce((s, i) => s + i.grossCents, 0),
      overdueCount: history.filter((i) => i.displayStatus === "OVERDUE").length,
    };
    return { contact: c, invoices: history, stats };
  });
}

export async function createContact(ctx: Ctx, input: z.infer<typeof contactSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const [c] = await tx.insert(contacts).values({ ...input, tenantId }).returning();
    await audit(tx, ctx, "contact.created", "Contact", c.id);
    return c;
  });
}

export async function updateContact(ctx: Ctx, id: string, input: z.infer<typeof contactUpdateSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const [c] = await tx.update(contacts).set(input)
      .where(and(eq(contacts.id, id), eq(contacts.tenantId, tenantId))).returning();
    if (!c) throw notFound("Kontakt");
    await audit(tx, ctx, "contact.updated", "Contact", id);
    return c;
  });
}
