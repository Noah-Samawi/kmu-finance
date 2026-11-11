import { route } from "@/lib/api";
import { AppError, badRequest } from "@/domain/errors";
import { SCAN_MAX_BYTES, SCAN_MIME_TYPES } from "@/domain/ocr";
import { scanReceipt } from "@/application/receipts/scan";
import { takeRateLimit } from "@/infrastructure/auth/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

/** multipart/form-data: file (Foto oder PDF) → { scan: { date, merchant, amountCents, vatRate, vatAmountCents, category, customCategory, description, payment } } */
export const POST = route(["ADMIN", "EMPLOYEE", "PARTNER"], async ({ req, ctx }) => {
  if (!takeRateLimit(`scan:${ctx.userId}`, 30, 10 * 60_000)) {
    throw new AppError(429, "RATE_LIMIT", "Zu viele Beleg-Scans in kurzer Zeit. Bitte kurz warten oder manuell erfassen.");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("multipart/form-data erwartet");
  }
  const file = form.get("file");
  if (!file || typeof file !== "object" || typeof (file as File).arrayBuffer !== "function") throw badRequest("Foto/Datei fehlt");
  const f = file as File;
  const mime = (f.type || "").toLowerCase();
  if (!(SCAN_MIME_TYPES as readonly string[]).includes(mime)) {
    throw badRequest("Dateityp nicht unterstützt (JPG, PNG, WebP, HEIC oder PDF)");
  }
  if (f.size > SCAN_MAX_BYTES) throw badRequest("Datei ist zu groß für den automatischen Scan (max. 4 MB)");
  const scan = await scanReceipt({ data: Buffer.from(await f.arrayBuffer()), mime });
  return { scan };
});
