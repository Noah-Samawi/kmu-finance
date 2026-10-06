import { z } from "zod";
import { fileResponse, query, route } from "@/lib/api";
import { rangeSchema } from "@/lib/validation/schemas";
import { exportReport } from "@/application/reports/export";

const schema = rangeSchema.extend({ format: z.enum(["csv", "pdf"]).default("csv") });

/** ?format=csv|pdf&from=...&to=... – Export für den Steuerberater */
export const GET = route(["ADMIN", "EMPLOYEE"], async ({ req, ctx }) => {
  const q = schema.parse(query(req));
  const f = await exportReport(ctx, q.format, q.from, q.to, q.employeeId);
  return fileResponse(f.data, f.mime, f.filename);
});
