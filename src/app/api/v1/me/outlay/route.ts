import { body, route } from "@/lib/api";
import { outlaySchema } from "@/lib/validation/schemas";
import { recordEmployeeOutlay } from "@/application/outlay/outlay";

export const POST = route(["EMPLOYEE"], async ({ req, ctx }) =>
  recordEmployeeOutlay(ctx, await body(req, outlaySchema)));
