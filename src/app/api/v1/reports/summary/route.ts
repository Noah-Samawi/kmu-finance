import { query, route } from "@/lib/api";
import { rangeSchema } from "@/lib/validation/schemas";
import { getSummary } from "@/application/reports/reports";

/** ?from=2026-10-01&to=2026-10-31[&employeeId=][&branch=] */
export const GET = route(["ADMIN", "EMPLOYEE", "PARTNER"], async ({ req, ctx }) => {
  const { from, to, employeeId, branch } = rangeSchema.parse(query(req));
  return getSummary(ctx, from, to, employeeId, branch);
});
