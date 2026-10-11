import { body, route } from "@/lib/api";
import { payslipCreateSchema } from "@/lib/validation/schemas";
import { createPayslip } from "@/application/hr/hr";

export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  createPayslip(ctx, params.id, await body(req, payslipCreateSchema)));
