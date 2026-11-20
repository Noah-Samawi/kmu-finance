import { body, route } from "@/lib/api";
import { forgotPasswordSchema, requestPasswordReset } from "@/application/auth-password-reset";

export const POST = route("public", async ({ req }) => {
  const { email } = await body(req, forgotPasswordSchema);
  return requestPasswordReset(email);
});
