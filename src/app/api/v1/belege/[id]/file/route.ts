import { fileResponse, route } from "@/lib/api";
import { getBelegFile } from "@/application/belege/belege";

export const runtime = "nodejs";

export const GET = route<{ id: string }>(["ADMIN"], async ({ ctx, params }) => {
  const f = await getBelegFile(ctx, params.id);
  return fileResponse(f.data, f.mime, f.name, true);
});
