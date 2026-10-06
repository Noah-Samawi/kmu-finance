import { route } from "@/lib/api";
import { badRequest } from "@/domain/errors";
import { markPaidSchema } from "@/lib/validation/schemas";
import { markInvoicePaid } from "@/application/invoices/lifecycle";

/** OPEN -> PAID, Betrag fließt automatisch in den Einnahmen-Pool. Body optional: { paidAt: "2026-10-06" } */
export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  const text = await req.text();
  let json: unknown = {};
  try {
    if (text) json = JSON.parse(text);
  } catch {
    throw badRequest("Ungültiges JSON");
  }
  const { paidAt } = markPaidSchema.parse(json);
  return { invoice: await markInvoicePaid(ctx, params.id, paidAt) };
});
