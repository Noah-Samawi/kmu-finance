import { body, route } from "@/lib/api";
import { partnerUpdateSchema } from "@/lib/validation/schemas";
import { getPartner, updatePartner } from "@/application/partners/partners";

export const GET = route<{ id: string }>(["ADMIN", "PARTNER"], async ({ ctx, params }) =>
  getPartner(ctx, params.id));

export const PATCH = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  updatePartner(ctx, params.id, await body(req, partnerUpdateSchema)));
