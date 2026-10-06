import { fileResponse, query, route } from "@/lib/api";
import { getInvoicePdf } from "@/application/invoices/lifecycle";

/** ?inline=1 zeigt das PDF im Browser statt Download */
export const GET = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  const { filename, data } = await getInvoicePdf(ctx, params.id);
  return fileResponse(data, "application/pdf", filename, query(req).inline === "1");
});
