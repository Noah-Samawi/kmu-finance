import { body, route } from "@/lib/api";
import { removeEntrySchema } from "@/lib/validation/schemas";
import { removeLedgerEntry } from "@/application/ledger/corrections";

/** Buchung komplett entfernen (aus allen Ansichten, Kontostand neu): { reason } */
export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  const { reason } = await body(req, removeEntrySchema);
  return removeLedgerEntry(ctx, params.id, reason);
});
