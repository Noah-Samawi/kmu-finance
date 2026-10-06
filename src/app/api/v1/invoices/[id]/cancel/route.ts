import { body, route } from "@/lib/api";
import { cancelInvoiceSchema } from "@/lib/validation/schemas";
import { cancelInvoice } from "@/application/invoices/lifecycle";

/** Stornorechnung erzeugen; bei bezahlter Rechnung wird die Einnahme zurückgebucht */
export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  const { reason } = await body(req, cancelInvoiceSchema);
  return { invoice: await cancelInvoice(ctx, params.id, reason) };
});
