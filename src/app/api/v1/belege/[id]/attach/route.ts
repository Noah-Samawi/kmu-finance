import { body, route } from "@/lib/api";
import { z } from "zod";
import { attachBelegToEntry } from "@/application/belege/belege";

export const runtime = "nodejs";

const schema = z.object({
  ledgerEntryId: z.string().min(1).max(64),
});

/** Posteingang-Beleg an bestehende Buchung hängen (keine Doppelbuchung). */
export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  const { ledgerEntryId } = await body(req, schema);
  return attachBelegToEntry(ctx, params.id, ledgerEntryId);
});
