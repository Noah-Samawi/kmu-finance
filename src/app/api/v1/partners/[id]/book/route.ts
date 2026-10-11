import { body, route } from "@/lib/api";
import { partnerBookSchema } from "@/lib/validation/schemas";
import { adminBookPartner } from "@/application/partners/partner-bookings";

export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  adminBookPartner(ctx, params.id, await body(req, partnerBookSchema)));
