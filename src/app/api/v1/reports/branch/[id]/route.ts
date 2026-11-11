import { z } from "zod";
import { fileResponse, query, route } from "@/lib/api";
import { rangeSchema } from "@/lib/validation/schemas";
import { exportBranchReport } from "@/application/reports/branch-report";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = rangeSchema.extend({ stem: z.enum(["monatsbericht", "filialbericht"]).optional() });

/** Filial-Einzelbericht als PDF: ?from=JJJJ-MM-TT&to=JJJJ-MM-TT[&stem=filialbericht] */
export const GET = route<{ id: string }>(["ADMIN", "PARTNER"], async ({ req, ctx, params }) => {
  const q = schema.parse(query(req));
  const f = await exportBranchReport(ctx, params.id, q.from, q.to, {
    filePrefix: q.stem === "filialbericht" ? "Filialbericht" : "Monatsbericht",
  });
  return fileResponse(f.data, f.mime, f.filename);
});
