import { fileResponse, route } from "@/lib/api";
import { getHrDocumentFile } from "@/application/hr/hr";

export const GET = route<{ id: string; docId: string }>(["ADMIN", "EMPLOYEE"], async ({ ctx, params }) => {
  const f = await getHrDocumentFile(ctx, params.id, params.docId);
  return fileResponse(f.data, f.mime, f.name, true);
});
