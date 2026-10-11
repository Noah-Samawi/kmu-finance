import { fileResponse, route } from "@/lib/api";
import { getPartnerBookingReceipt } from "@/application/partners/partner-bookings";

export const runtime = "nodejs";

export const GET = route<{ id: string }>(["ADMIN", "PARTNER"], async ({ ctx, params }) => {
  const f = await getPartnerBookingReceipt(ctx, params.id);
  return fileResponse(f.data, f.mime, f.name, true);
});
