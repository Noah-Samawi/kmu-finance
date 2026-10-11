import { body, route } from "@/lib/api";
import { cashExpenseSchema } from "@/lib/validation/schemas";
import { recordCashExpense } from "@/application/wallet/wallet";

export const POST = route(["EMPLOYEE"], async ({ req, ctx }) =>
  recordCashExpense(ctx, await body(req, cashExpenseSchema)));
