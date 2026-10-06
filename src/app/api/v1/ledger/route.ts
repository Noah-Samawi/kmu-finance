import { z } from "zod";
import { query, route } from "@/lib/api";
import { dateStr } from "@/lib/validation/schemas";
import { listLedger } from "@/application/reports/reports";

const filter = z.object({ from: dateStr.optional(), to: dateStr.optional(), employeeId: z.string().optional() });

/** Buchungsjournal. Mitarbeiter erhalten nur ihre eigenen Buchungen. */
export const GET = route(["ADMIN", "EMPLOYEE"], async ({ req, ctx }) => ({
  entries: await listLedger(ctx, filter.parse(query(req))),
}));
