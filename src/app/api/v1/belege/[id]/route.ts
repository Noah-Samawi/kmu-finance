import { body, route } from "@/lib/api";
import { getBeleg, updateBelegDraft, belegBookSchema } from "@/application/belege/belege";
import { z } from "zod";

export const runtime = "nodejs";

export const GET = route<{ id: string }>(["ADMIN"], async ({ ctx, params }) => getBeleg(ctx, params.id));

const draftSchema = belegBookSchema.partial().extend({
  docType: z.enum(["CASH", "INCOMING_INVOICE", "OUTGOING_INVOICE", "OTHER"]).optional(),
});

export const PATCH = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  updateBelegDraft(ctx, params.id, await body(req, draftSchema)));
