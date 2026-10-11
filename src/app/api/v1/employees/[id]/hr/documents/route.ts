import { badRequest } from "@/domain/errors";
import { route } from "@/lib/api";
import { uploadHrDocument } from "@/application/hr/hr";

export const runtime = "nodejs";

export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  let form: FormData;
  try { form = await req.formData(); } catch { throw badRequest("multipart/form-data erwartet"); }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Datei fehlt");
  const kindRaw = String(form.get("kind") ?? "OTHER");
  const kind = ["ID", "CONTRACT", "TIMESHEET", "TAX", "PAYSLIP", "OTHER"].includes(kindRaw)
    ? kindRaw as "ID" | "CONTRACT" | "TIMESHEET" | "TAX" | "PAYSLIP" | "OTHER"
    : "OTHER";
  return uploadHrDocument(ctx, params.id, {
    kind, title: String(form.get("title") ?? file.name), notes: String(form.get("notes") ?? "") || null,
  }, { data: Buffer.from(await file.arrayBuffer()), mime: file.type, name: file.name });
});
