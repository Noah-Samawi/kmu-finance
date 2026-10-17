import { z } from "zod";
import { query, route } from "@/lib/api";
import { dateStr } from "@/lib/validation/schemas";
import { dayIncomes } from "@/application/cash/cash";

/** ?date=JJJJ-MM-TT – bestehende Einnahmen des Tages (Dubletten-Hinweis) */
export const GET = route(["ADMIN"], async ({ req, ctx }) => {
  const q = z.object({ date: dateStr }).parse(query(req));
  return dayIncomes(ctx, q.date);
});
