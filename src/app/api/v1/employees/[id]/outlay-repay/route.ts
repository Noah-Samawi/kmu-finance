import { body, route } from "@/lib/api";
import { outlayRepaySchema } from "@/lib/validation/schemas";
import { repayOutlay } from "@/application/outlay/outlay";

export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  repayOutlay(ctx, params.id, await body(req, outlayRepaySchema)));
