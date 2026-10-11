import { route } from "@/lib/api";
import { badRequest } from "@/domain/errors";
import { partnerSelfBookSchema } from "@/lib/validation/schemas";
import { getPartner } from "@/application/partners/partners";
import { selfBookPartner } from "@/application/partners/partner-bookings";

export const runtime = "nodejs";
export const maxDuration = 30;

export const GET = route(["PARTNER"], async ({ ctx }) => {
  const p = await getPartner(ctx, ctx.userId);
  return { capitalCents: p.capitalCents, outlayOpenCents: p.outlayOpenCents, budgetCents: p.budgetCents, bookings: p.bookings };
});

function isUpload(v: FormDataEntryValue | null): v is File {
  return !!v && typeof v === "object" && typeof (v as File).arrayBuffer === "function" && (v as File).size > 0;
}

/** multipart/form-data: kind, source, amount ("12,50"), purpose, bookingDate?, file? */
export const POST = route(["PARTNER"], async ({ req, ctx }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("multipart/form-data erwartet");
  }
  const input = partnerSelfBookSchema.parse({
    kind: form.get("kind") || undefined,
    source: form.get("source") || undefined,
    amountCents: String(form.get("amount") ?? ""),
    purpose: String(form.get("purpose") ?? ""),
    bookingDate: form.get("bookingDate") || undefined,
  });
  const file = form.get("file");
  const upload = isUpload(file)
    ? { data: Buffer.from(await file.arrayBuffer()), mime: file.type ?? "", name: file.name ?? "" }
    : null;
  return selfBookPartner(ctx, input, upload);
});
