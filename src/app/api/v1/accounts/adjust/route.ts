import { body, route } from "@/lib/api";
import { accountAdjustSchema } from "@/lib/validation/schemas";
import { adjustAccount } from "@/application/pool/pool";

export const POST = route(["ADMIN"], async ({ req, ctx }) =>
  adjustAccount(ctx, await body(req, accountAdjustSchema)));
