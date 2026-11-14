import { badRequest } from "@/domain/errors";
import { body, route } from "@/lib/api";
import { wagePayoutSchema } from "@/lib/validation/schemas";
import { payWage } from "@/application/employees/employees";
import { readUpload } from "@/application/receipts/store-file";

export const runtime = "nodejs";

/** Lohn auszahlen: JSON oder multipart { amount|amountCents, fund: CASH|BANK, bookingDate?, description?, file? } */
export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return payWage(ctx, params.id, await body(req, wagePayoutSchema));
  }
  let form: FormData;
  try { form = await req.formData(); } catch { throw badRequest("multipart/form-data erwartet"); }
  const input = wagePayoutSchema.parse({
    amountCents: String(form.get("amount") ?? form.get("amountCents") ?? ""),
    fund: form.get("fund") || undefined,
    bookingDate: form.get("bookingDate") || undefined,
    description: form.get("description") || undefined,
    branchId: form.get("branchId") || null,
  });
  return payWage(ctx, params.id, input, await readUpload(form.get("file")));
});
