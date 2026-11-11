import { body, route } from "@/lib/api";
import { tenantDeleteSchema, tenantUpdateSchema } from "@/lib/validation/schemas";
import { deleteTenant, getTenant, updateTenant } from "@/application/tenants/tenants";

type P = { id: string };

export const GET = route<P>(["SUPER_ADMIN"], async ({ ctx, params }) => ({ tenant: await getTenant(ctx, params.id) }));

/** Stammdaten ändern oder { "status": "SUSPENDED" | "ACTIVE" } */
export const PATCH = route<P>(["SUPER_ADMIN"], async ({ req, ctx, params }) => ({
  tenant: await updateTenant(ctx, params.id, await body(req, tenantUpdateSchema)),
}));

/** Firma samt allen Daten löschen: { "confirm": "<Kurzname>" | "LÖSCHEN" } */
export const DELETE = route<P>(["SUPER_ADMIN"], async ({ req, ctx, params }) =>
  deleteTenant(ctx, params.id, await body(req, tenantDeleteSchema)));
