import { z } from "zod";
import { errorDetails, query, route } from "@/lib/api";
import { AppError, badRequest, isAppError } from "@/domain/errors";
import { receiptFieldsSchema } from "@/lib/validation/schemas";
import { listReceipts, submitReceipt } from "@/application/receipts/receipts";
import { blobToken, blobTokenSource, storageDiagnostics } from "@/infrastructure/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

const filter = z.object({
  status: z.enum(["SUBMITTED", "APPROVED", "REJECTED"]).optional(),
  employeeId: z.string().optional(),
});

export const GET = route(["ADMIN", "EMPLOYEE"], async ({ req, ctx }) => ({
  receipts: await listReceipts(ctx, filter.parse(query(req))),
}));

function isUpload(v: FormDataEntryValue | null): v is File {
  return !!v && typeof v === "object" && typeof (v as File).arrayBuffer === "function";
}

/** multipart/form-data: file, amount ("12,50"), merchant, description?, receiptDate, vatRate? */
export const POST = route(["EMPLOYEE"], async ({ req, ctx }) => {
  const diag = storageDiagnostics();
  console.info("[receipts POST] start", {
    userId: ctx.userId,
    tenantId: ctx.tenantId,
    contentType: req.headers.get("content-type"),
    contentLength: req.headers.get("content-length"),
    ...diag,
  });
  const token = blobToken();
  if (!token) {
    console.error(
      "[receipts POST] KEIN Vercel-Blob-Token gefunden. " +
        "Weder process.env.BLOB_READ_WRITE_TOKEN noch process.env.VERCEL_BLOB_READ_WRITE_TOKEN ist gesetzt. " +
        "In Vercel: Storage → Blob Store mit dem Projekt verknüpfen oder eine der beiden Env-Vars setzen.",
      diag,
    );
  } else {
    console.info("[receipts POST] Blob-Token gelesen", {
      source: blobTokenSource(),
      length: token.length,
      prefix: `${token.slice(0, 12)}…`,
    });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    console.error("[receipts POST] formData parse failed", errorDetails(e), diag);
    throw badRequest("multipart/form-data erwartet");
  }

  const file = form.get("file");
  if (!isUpload(file)) {
    console.error("[receipts POST] keine Datei im FormData", { keys: [...form.keys()], fileType: typeof file });
    throw badRequest("Foto/Datei fehlt");
  }

  let fields;
  try {
    fields = receiptFieldsSchema.parse({
      amountCents: String(form.get("amount") ?? form.get("amountCents") ?? ""),
      merchant: form.get("merchant"),
      description: form.get("description") || null,
      receiptDate: form.get("receiptDate"),
      vatRate: form.get("vatRate") || null,
    });
  } catch (e) {
    console.error("[receipts POST] Validierung fehlgeschlagen", errorDetails(e));
    throw e;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = "type" in file && typeof file.type === "string" ? file.type : "";
  console.info("[receipts POST] file ok", { bytes: bytes.length, mime, merchant: fields.merchant });

  try {
    const result = await submitReceipt(ctx, fields, { data: bytes, mime });
    console.info("[receipts POST] ok", { receiptId: result.receipt.id, backend: diag.backend });
    return result;
  } catch (e) {
    const stage = isAppError(e) ? e.code : "UNKNOWN";
    console.error("[receipts POST] failed", { stage, ...diag, ...errorDetails(e) });
    if (isAppError(e)) throw e;
    throw new AppError(
      500,
      "INTERNAL",
      `Interner Fehler (${diag.backend === "vercel-blob" ? "Blob-Speicher oder Datenbank" : diag.backend})`,
    );
  }
});
