import { z } from "zod";
import { query, route } from "@/lib/api";
import { badRequest } from "@/domain/errors";
import { receiptFieldsSchema } from "@/lib/validation/schemas";
import { listReceipts, submitReceipt } from "@/application/receipts/receipts";

const filter = z.object({
  status: z.enum(["SUBMITTED", "APPROVED", "REJECTED"]).optional(),
  employeeId: z.string().optional(),
});

export const GET = route(["ADMIN", "EMPLOYEE"], async ({ req, ctx }) => ({
  receipts: await listReceipts(ctx, filter.parse(query(req))),
}));

/** multipart/form-data: file, amount ("12,50"), merchant, description?, receiptDate, vatRate? */
export const POST = route(["EMPLOYEE"], async ({ req, ctx }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("multipart/form-data erwartet");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Foto/Datei fehlt");
  const fields = receiptFieldsSchema.parse({
    amountCents: String(form.get("amount") ?? form.get("amountCents") ?? ""),
    merchant: form.get("merchant"),
    description: form.get("description") || null,
    receiptDate: form.get("receiptDate"),
    vatRate: form.get("vatRate") || null,
  });
  return submitReceipt(ctx, fields, { data: Buffer.from(await file.arrayBuffer()), mime: file.type });
});
