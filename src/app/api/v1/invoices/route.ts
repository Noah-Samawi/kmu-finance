import { z } from "zod";
import { body, query, route } from "@/lib/api";
import { invoiceDraftSchema } from "@/lib/validation/schemas";
import { createDraft, listInvoices } from "@/application/invoices/drafts";

const filter = z.object({
  status: z.enum(["DRAFT", "OPEN", "PAID", "OVERDUE", "CANCELED"]).optional(),
  contactId: z.string().optional(),
  q: z.string().max(100).optional(),
});

/** ?status=OVERDUE&contactId=...&q=RE-2026 */
export const GET = route(["ADMIN"], async ({ req, ctx }) => ({
  invoices: await listInvoices(ctx, filter.parse(query(req))),
}));

/** Neuer Entwurf */
export const POST = route(["ADMIN"], async ({ req, ctx }) => ({
  invoice: await createDraft(ctx, await body(req, invoiceDraftSchema)),
}));
