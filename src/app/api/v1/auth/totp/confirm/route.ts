import { body, route } from "@/lib/api";
import { confirmTotpEnrollment, totpConfirmSchema } from "@/application/auth-totp";

export const POST = route(["ADMIN"], async ({ req, ctx }) => {
  const { secret, code } = await body(req, totpConfirmSchema);
  return confirmTotpEnrollment(ctx, secret, code);
});
