import { body, route } from "@/lib/api";
import { partnerCreateSchema } from "@/lib/validation/schemas";
import { createPartner, listPartners } from "@/application/partners/partners";

export const GET = route(["ADMIN"], async ({ ctx }) => ({ partners: await listPartners(ctx) }));

export const POST = route(["ADMIN"], async ({ req, ctx }) => ({
  partner: await createPartner(ctx, await body(req, partnerCreateSchema)),
}));
