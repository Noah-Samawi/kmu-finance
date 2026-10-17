import { randomUUID } from "node:crypto";
import { blobToken, storage } from "@/infrastructure/storage";
import { AppError, badRequest, isAppError } from "@/domain/errors";
import { ALLOWED_MIME, resolveReceiptMime } from "./mime";
import { toReceiptDataUrl } from "./inline-file";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface UploadFile { data: Buffer; mime: string; name: string }

/** Beleg speichern: mit Blob-Token im Dateispeicher, sonst als Data-URL in der Datenbank */
export async function storeReceiptFile(tenantId: string, folder: string, file: UploadFile) {
  const mime = resolveReceiptMime(file.mime, file.data);
  const ext = mime ? ALLOWED_MIME[mime] : undefined;
  if (!mime || !ext) throw badRequest("Dateityp nicht erlaubt (JPG, PNG, WEBP, HEIC oder PDF)");
  if (file.data.length === 0) throw badRequest("Datei ist leer");
  if (file.data.length > MAX_FILE_BYTES) throw badRequest("Datei ist größer als 10 MB");
  const name = (file.name || `beleg.${ext}`).replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120);
  if (!blobToken()) return { key: toReceiptDataUrl(mime, file.data), mime, name };
  const key = `${tenantId}/${folder}/${randomUUID()}.${ext}`;
  try {
    await storage.put(key, file.data, mime);
  } catch (e) {
    if (isAppError(e)) throw e;
    throw new AppError(503, "STORAGE", "Beleg konnte nicht gespeichert werden");
  }
  return { key, mime, name };
}

export function isUpload(v: FormDataEntryValue | null): v is File {
  return !!v && typeof v === "object" && typeof (v as File).arrayBuffer === "function" && (v as File).size > 0;
}

export async function readUpload(v: FormDataEntryValue | null): Promise<UploadFile | null> {
  return isUpload(v) ? { data: Buffer.from(await v.arrayBuffer()), mime: v.type ?? "", name: v.name ?? "" } : null;
}
