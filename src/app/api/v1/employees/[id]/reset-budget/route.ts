import { route } from "@/lib/api";
import { resetWalletToZero } from "@/application/wallet/wallet";

/** Admin: Guthaben des Mitarbeiters auf 0,00 € setzen (Ausgleichsbuchung). */
export const POST = route<{ id: string }>(["ADMIN"], async ({ ctx, params }) =>
  resetWalletToZero(ctx, params.id));
