import { body, route } from "@/lib/api";
import { tenantUpdateSchema } from "@/lib/validation/schemas";
import { getTenant, updateTenant } from "@/application/tenants/tenants";

type P = { id: string };

export const GET = route<P>(["SUPER_ADMIN"], async ({ ctx, params }) => ({ tenant: await getTenant(ctx, params.id) }));

/** Stammdaten ändern oder { "status": "SUSPENDED" | "ACTIVE" } */
export const PATCH = route<P>(["SUPER_ADMIN"], async ({ req, ctx, params }) => ({
  tenant: await updateTenant(ctx, params.id, await body(req, tenantUpdateSchema)),
}));
