import { body, route } from "@/lib/api";
import { resetPasswordSchema, resetPasswordWithToken } from "@/application/auth-password-reset";

export const POST = route("public", async ({ req }) => {
  const { token, password } = await body(req, resetPasswordSchema);
  return resetPasswordWithToken(token, password);
});
