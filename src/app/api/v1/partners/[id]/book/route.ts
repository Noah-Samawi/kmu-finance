import { body, route } from "@/lib/api";
import { partnerBookSchema } from "@/lib/validation/schemas";
import { bookPartner } from "@/application/partners/partners";

export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  bookPartner(ctx, params.id, await body(req, partnerBookSchema)));
