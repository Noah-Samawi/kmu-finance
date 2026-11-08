import { body, route } from "@/lib/api";
import { editEntrySchema } from "@/lib/validation/schemas";
import { editLedgerEntry } from "@/application/ledger/corrections";

/** Buchung ändern: { amountCents?, description?, branchId?, reason } */
export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  return editLedgerEntry(ctx, params.id, await body(req, editEntrySchema));
});
