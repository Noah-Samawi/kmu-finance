import { body, route } from "@/lib/api";
import { disableTotp, totpCodeSchema } from "@/application/auth-totp";

export const POST = route(["ADMIN"], async ({ req, ctx }) => {
  const { code } = await body(req, totpCodeSchema);
  return disableTotp(ctx, code);
});
