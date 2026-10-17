import { fileResponse, route } from "@/lib/api";
import { getLedgerAttachment } from "@/application/cash/cash";

export const runtime = "nodejs";

export const GET = route<{ id: string }>(["ADMIN", "EMPLOYEE", "PARTNER"], async ({ ctx, params }) => {
  const f = await getLedgerAttachment(ctx, params.id);
  return fileResponse(f.data, f.mime, f.name, true);
});
