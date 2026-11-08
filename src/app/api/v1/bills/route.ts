import { z } from "zod";
import { badRequest } from "@/domain/errors";
import { query, route } from "@/lib/api";
import { incomingBillSchema } from "@/lib/validation/schemas";
import { listIncomingBills, recordIncomingBill } from "@/application/incoming-bills";
import { readUpload } from "@/application/receipts/store-file";

export const runtime = "nodejs";
export const maxDuration = 30;

const filter = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(["OPEN", "PAID", "CREDIT"]).optional(),
});

export const GET = route(["ADMIN"], async ({ req, ctx }) => ({
  bills: await listIncomingBills(ctx, filter.parse(query(req))),
}));

/** multipart: file, supplier, amount, payKind (CASH|BANK|UNPAID), category, purpose?, bookingDate?, branchId?, paid? */
export const POST = route(["ADMIN"], async ({ req, ctx }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("multipart/form-data erwartet");
  }
  const input = incomingBillSchema.parse({
    supplier: String(form.get("supplier") ?? ""),
    amountCents: String(form.get("amount") ?? form.get("amountCents") ?? ""),
    paidCents: form.get("paid") ?? form.get("paidCents") ?? undefined,
    payKind: form.get("payKind") || undefined,
    category: form.get("category") || undefined,
    purpose: form.get("purpose") || null,
    bookingDate: form.get("bookingDate") || undefined,
    branchId: form.get("branchId") || null,
  });
  return recordIncomingBill(ctx, input, await readUpload(form.get("file")));
});
