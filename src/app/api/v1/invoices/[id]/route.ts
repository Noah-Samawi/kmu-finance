import { body, route } from "@/lib/api";
import { invoiceDraftUpdateSchema } from "@/lib/validation/schemas";
import { deleteDraft, getInvoice, updateDraft } from "@/application/invoices/drafts";

type P = { id: string };

export const GET = route<P>(["ADMIN"], async ({ ctx, params }) => ({ invoice: await getInvoice(ctx, params.id) }));

/** Nur Entwürfe */
export const PATCH = route<P>(["ADMIN"], async ({ req, ctx, params }) => ({
  invoice: await updateDraft(ctx, params.id, await body(req, invoiceDraftUpdateSchema)),
}));

/** Nur Entwürfe – ausgestellte Rechnungen werden storniert */
export const DELETE = route<P>(["ADMIN"], async ({ ctx, params }) => {
  await deleteDraft(ctx, params.id);
  return { ok: true };
});
