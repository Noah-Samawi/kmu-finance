import { fileResponse, route } from "@/lib/api";
import { getIncomingBillFile } from "@/application/incoming-bills";

export const runtime = "nodejs";

export const GET = route<{ id: string }>(["ADMIN"], async ({ ctx, params }) => {
  const f = await getIncomingBillFile(ctx, params.id);
  return fileResponse(f.data, f.mime, f.name, true);
});
