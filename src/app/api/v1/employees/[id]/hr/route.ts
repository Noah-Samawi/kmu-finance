import { body, route } from "@/lib/api";
import { hrProfileSchema } from "@/lib/validation/schemas";
import { getPersonnelFile, upsertProfile } from "@/application/hr/hr";

export const GET = route<{ id: string }>(["ADMIN"], async ({ ctx, params }) =>
  getPersonnelFile(ctx, params.id));

export const PUT = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  upsertProfile(ctx, params.id, await body(req, hrProfileSchema)));
