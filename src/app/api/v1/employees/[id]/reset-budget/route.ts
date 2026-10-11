import { body, route } from "@/lib/api";
import { resetBudgetSchema } from "@/lib/validation/schemas";
import { resetWalletToZero } from "@/application/wallet/wallet";

export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  resetWalletToZero(ctx, params.id, await body(req, resetBudgetSchema)));
