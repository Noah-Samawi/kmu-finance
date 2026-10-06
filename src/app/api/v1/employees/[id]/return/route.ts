import { body, route } from "@/lib/api";
import { returnSchema } from "@/lib/validation/schemas";
import { returnToPool } from "@/application/wallet/wallet";

/** Restgeld zurück in den Pool: { all: true } oder { amountCents } */
export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  returnToPool(ctx, params.id, await body(req, returnSchema)));
