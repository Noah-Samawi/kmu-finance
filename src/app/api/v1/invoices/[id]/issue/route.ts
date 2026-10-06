import { route } from "@/lib/api";
import { issueInvoice } from "@/application/invoices/lifecycle";

/** DRAFT -> OPEN: Rechnungsnummer vergeben, PDF archivieren */
export const POST = route<{ id: string }>(["ADMIN"], async ({ ctx, params }) => ({
  invoice: await issueInvoice(ctx, params.id),
}));
