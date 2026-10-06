import { body, route } from "@/lib/api";
import { reviewSchema } from "@/lib/validation/schemas";
import { reviewReceipt } from "@/application/receipts/receipts";

/** { action: "approve" } oder { action: "reject", reason } – Ablehnen bucht den Betrag zurück aufs MA-Konto */
export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  const input = await body(req, reviewSchema);
  return { receipt: await reviewReceipt(ctx, params.id, input.action, input.action === "reject" ? input.reason : undefined) };
});
