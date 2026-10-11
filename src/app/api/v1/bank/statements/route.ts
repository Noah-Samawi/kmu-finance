import { badRequest } from "@/domain/errors";
import { route } from "@/lib/api";
import { listBankStatements, uploadBankStatement } from "@/application/bank/bank";

export const runtime = "nodejs";

export const GET = route(["ADMIN"], async ({ ctx }) => ({ statements: await listBankStatements(ctx) }));

export const POST = route(["ADMIN"], async ({ req, ctx }) => {
  let form: FormData;
  try { form = await req.formData(); } catch { throw badRequest("multipart/form-data erwartet"); }
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Kontoauszug fehlt (CSV/OFX/PDF-Text)");
  const periodMonth = String(form.get("periodMonth") ?? "").slice(0, 7);
  return uploadBankStatement(ctx, periodMonth, {
    data: Buffer.from(await file.arrayBuffer()), mime: file.type, name: file.name,
  });
});
