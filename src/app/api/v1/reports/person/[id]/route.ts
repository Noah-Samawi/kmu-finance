import { fileResponse, query, route } from "@/lib/api";
import { rangeSchema } from "@/lib/validation/schemas";
import { exportPersonReport } from "@/application/reports/person-report";

export const runtime = "nodejs";

/** Einzelbericht als PDF: ?from=JJJJ-MM-TT&to=JJJJ-MM-TT (Mitarbeiter/Gesellschafter nur eigener) */
export const GET = route<{ id: string }>(["ADMIN", "EMPLOYEE", "PARTNER"], async ({ req, ctx, params }) => {
  const q = rangeSchema.parse(query(req));
  const f = await exportPersonReport(ctx, params.id, q.from, q.to);
  return fileResponse(f.data, "application/pdf", f.filename);
});
