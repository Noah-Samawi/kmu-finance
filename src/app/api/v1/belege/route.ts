import { badRequest } from "@/domain/errors";
import { body, query, route } from "@/lib/api";
import { z } from "zod";
import { belegUploadMetaSchema, listBelege, uploadBeleg } from "@/application/belege/belege";
import { readUpload } from "@/application/receipts/store-file";
import { BELEG_STATUSES } from "@/domain/beleg";

export const runtime = "nodejs";
export const maxDuration = 60;

const listFilter = z.object({
  status: z.enum([...BELEG_STATUSES, "ALL"]).optional(),
  branchId: z.string().optional(),
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const GET = route(["ADMIN"], async ({ req, ctx }) => ({
  belege: await listBelege(ctx, listFilter.parse(query(req))),
}));

export const POST = route(["ADMIN"], async ({ req, ctx }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("multipart/form-data erwartet");
  }
  const file = await readUpload(form.get("file"));
  if (!file) throw badRequest("Datei fehlt");
  const meta = belegUploadMetaSchema.parse({
    docType: form.get("docType") || "OTHER",
    branchId: form.get("branchId") || null,
  });
  return uploadBeleg(ctx, file, meta);
});
