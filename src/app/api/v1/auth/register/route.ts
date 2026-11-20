import { body, route } from "@/lib/api";
import { registerSchema, registerSuperuser } from "@/application/auth-register";

export const POST = route("public", async ({ req }) => {
  const input = await body(req, registerSchema);
  return registerSuperuser(input);
});
