import { body, route } from "@/lib/api";
import { tenantCreateSchema } from "@/lib/validation/schemas";
import { createTenant, listTenants } from "@/application/tenants/tenants";

export const GET = route(["SUPER_ADMIN"], async ({ ctx }) => ({ tenants: await listTenants(ctx) }));

export const POST = route(["SUPER_ADMIN"], async ({ req, ctx }) => ({
  tenant: await createTenant(ctx, await body(req, tenantCreateSchema)),
}));
