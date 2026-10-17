import { z } from "zod";
import { query, route } from "@/lib/api";
import { dateStr } from "@/lib/validation/schemas";
import { balanceAt } from "@/application/cash/cash";

/** ?date=JJJJ-MM-TT&account=CASH|BANK – Buchbestand am Ende des Stichtags */
export const GET = route(["ADMIN"], async ({ req, ctx }) => {
  const q = z.object({ date: dateStr, account: z.enum(["CASH", "BANK"]) }).parse(query(req));
  return balanceAt(ctx, q.date, q.account);
});
