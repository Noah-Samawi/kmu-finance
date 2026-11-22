import { badRequest } from "@/domain/errors";
import { body, route } from "@/lib/api";
import { z } from "zod";
import { detachBelegFromEntry } from "@/application/belege/belege";
import { removeLedgerEntry, reverseLedgerEntry } from "@/application/ledger/corrections";

export const runtime = "nodejs";

const schema = z.object({
  /** file = nur Datei; reverse = Datei + Storno; remove = Datei + Löschen */
  mode: z.enum(["file", "reverse", "remove"]).default("file"),
  reason: z.string().trim().min(3).max(500).optional(),
});

export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  const { mode, reason } = await body(req, schema);
  if (mode !== "file" && !reason?.trim()) throw badRequest("Grund fehlt (mind. 3 Zeichen)");
  const detached = await detachBelegFromEntry(ctx, params.id, {
    belegTo: mode === "file" ? "INBOX" : "TRASH",
  });
  if (mode === "file") return { ...detached, booking: null };
  const booking = mode === "reverse"
    ? await reverseLedgerEntry(ctx, params.id, reason!.trim())
    : await removeLedgerEntry(ctx, params.id, reason!.trim());
  return { ...detached, booking };
});
