import { body, route } from "@/lib/api";
import { adjustSchema } from "@/lib/validation/schemas";
import { adjustWallet } from "@/application/wallet/wallet";

/** Manuelle Ausgleichsbuchung: { toZero: true, description } oder { amountCents, description } */
export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  adjustWallet(ctx, params.id, await body(req, adjustSchema)));
