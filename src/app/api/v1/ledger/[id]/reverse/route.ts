import { body, route } from "@/lib/api";
import { reverseSchema } from "@/lib/validation/schemas";
import { reverseEntry } from "@/application/wallet/wallet";

/** Fehlbuchung stornieren: { reason } */
export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  const { reason } = await body(req, reverseSchema);
  return reverseEntry(ctx, params.id, reason);
});
