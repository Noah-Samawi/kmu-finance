import { badRequest } from "@/domain/errors";
import { body, route } from "@/lib/api";
import { expenseSchema } from "@/lib/validation/schemas";
import { recordExpense } from "@/application/cash/cash";
import { readUpload } from "@/application/receipts/store-file";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Betriebsausgabe: JSON oder multipart/form-data
 * { fund: CASH|BANK|BUDGET, category, amount|amountCents, purpose, bookingDate?, personId?, file? }
 */
export const POST = route(["ADMIN"], async ({ req, ctx }) => {
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return recordExpense(ctx, await body(req, expenseSchema));
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("multipart/form-data erwartet");
  }
  const input = expenseSchema.parse({
    fund: form.get("fund") || undefined,
    category: form.get("category") || undefined,
    amountCents: String(form.get("amount") ?? form.get("amountCents") ?? ""),
    purpose: String(form.get("purpose") ?? ""),
    bookingDate: form.get("bookingDate") || undefined,
    personId: form.get("personId") || undefined,
  });
  return recordExpense(ctx, input, await readUpload(form.get("file")));
});
