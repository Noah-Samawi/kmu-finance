import { body, route } from "@/lib/api";
import { partnerRefundSchema } from "@/lib/validation/schemas";
import { refundPartnerOutlays } from "@/application/partners/partner-bookings";

/** Auslagen-Erstattung: nur explizit zugeordnete offene Auslagen werden getilgt */
export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  refundPartnerOutlays(ctx, params.id, await body(req, partnerRefundSchema)));
