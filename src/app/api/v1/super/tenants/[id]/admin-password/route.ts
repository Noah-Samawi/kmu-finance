import { body, route } from "@/lib/api";
import { tenantAdminPasswordSchema } from "@/lib/validation/schemas";
import { resetTenantAdminPassword } from "@/application/tenants/tenants";

/** Passwort des ersten Firmen-Admins setzen: { "password"?: string } – ohne Angabe zufällig. Antwort enthält das Passwort einmalig. */
export const POST = route<{ id: string }>(["SUPER_ADMIN"], async ({ req, ctx, params }) => {
  const input = await body(req, tenantAdminPasswordSchema);
  return { ...(await resetTenantAdminPassword(ctx, params.id, input)) };
});
