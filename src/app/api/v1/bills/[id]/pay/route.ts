import { body, route } from "@/lib/api";
import { payIncomingBillSchema } from "@/lib/validation/schemas";
import { payIncomingBill } from "@/application/incoming-bills";

export const runtime = "nodejs";

export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  payIncomingBill(ctx, params.id, await body(req, payIncomingBillSchema)));
