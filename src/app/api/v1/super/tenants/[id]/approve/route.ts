import { route } from "@/lib/api";
import { approveTenant } from "@/application/tenants/tenants";

type P = { id: string };

/** Freigabe: Tenant + Owner auf ACTIVE / Login-fähig */
export const POST = route<P>(["SUPER_ADMIN"], async ({ ctx, params }) =>
  approveTenant(ctx, params.id));
