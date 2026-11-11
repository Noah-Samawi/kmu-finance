import { z } from "zod";
import { fileResponse, query, route } from "@/lib/api";
import { rangeSchema } from "@/lib/validation/schemas";
import { exportReport } from "@/application/reports/export";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = rangeSchema.extend({ format: z.enum(["csv", "pdf", "zip"]).default("csv") });

/** ?format=csv|pdf|zip&from=...&to=...[&branch=] – ein PDF, CSV oder ZIP je Filiale */
export const GET = route(["ADMIN", "EMPLOYEE", "PARTNER"], async ({ req, ctx }) => {
  const q = schema.parse(query(req));
  const f = await exportReport(ctx, q.format, q.from, q.to, q.employeeId, q.branch);
  return fileResponse(f.data, f.mime, f.filename);
});
