import { badRequest } from "@/domain/errors";
import { route } from "@/lib/api";
import { listBankStatements, previewBankStatement, uploadBankStatement } from "@/application/bank/bank";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = route(["ADMIN"], async ({ ctx }) => ({ statements: await listBankStatements(ctx) }));

/** Vorschau (kein Buchen): multipart file + periodMonth → Ampel, Salden, Duplikat-Hinweise */
export const POST = route(["ADMIN"], async ({ req, ctx }) => {
  let form: FormData;
  try { form = await req.formData(); } catch { throw badRequest("multipart/form-data erwartet"); }
  const periodMonth = String(form.get("periodMonth") ?? "").slice(0, 7);
  const confirm = form.get("confirm") === "1";

  if (confirm) {
    // Bestätigung: Originaldatei erneut (als base64) oder als file
    const b64 = String(form.get("fileB64") ?? "");
    const name = String(form.get("fileName") ?? "kontoauszug.bin");
    const mime = String(form.get("fileMime") ?? "application/octet-stream");
    let data: Buffer;
    if (b64) data = Buffer.from(b64, "base64");
    else {
      const file = form.get("file");
      if (!(file instanceof File)) throw badRequest("Kontoauszug fehlt");
      data = Buffer.from(await file.arrayBuffer());
    }
    if (!data.length) throw badRequest("Kontoauszug fehlt");
    const opening = form.get("openingCents");
    const closing = form.get("closingCents");
    return uploadBankStatement(ctx, periodMonth, { data, mime, name }, {
      autoBook: form.get("autoBook") === "1",
      branchId: String(form.get("branchId") ?? "") || null,
      expectedSha: String(form.get("fileSha256") ?? "") || null,
      openingCents: opening !== null && opening !== "" ? Number(opening) : null,
      closingCents: closing !== null && closing !== "" ? Number(closing) : null,
      force: form.get("force") === "1",
    });
  }

  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Kontoauszug fehlt (CSV/OFX/PDF/Foto)");
  return previewBankStatement(ctx, periodMonth, {
    data: Buffer.from(await file.arrayBuffer()), mime: file.type, name: file.name,
  }, { forceAi: form.get("forceAi") === "1" });
});
