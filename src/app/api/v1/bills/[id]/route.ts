import { body, route } from "@/lib/api";
import { cancelIncomingBillSchema } from "@/lib/validation/schemas";
import { cancelIncomingBill } from "@/application/incoming-bills";

export const runtime = "nodejs";

export const DELETE = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  cancelIncomingBill(ctx, params.id, await body(req, cancelIncomingBillSchema)));
