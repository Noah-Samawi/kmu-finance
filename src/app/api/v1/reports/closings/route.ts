import { body, route } from "@/lib/api";
import { closingSchema } from "@/lib/validation/schemas";
import { closePeriod, listClosings } from "@/application/reports/reports";

export const GET = route(["ADMIN"], async ({ ctx }) => ({ closings: await listClosings(ctx) }));

/** { periodType: "DAY", period: "2026-10-06" } oder { periodType: "MONTH", period: "2026-09" } */
export const POST = route(["ADMIN"], async ({ req, ctx }) => {
  const { periodType, period } = await body(req, closingSchema);
  return { closing: await closePeriod(ctx, periodType, period) };
});
