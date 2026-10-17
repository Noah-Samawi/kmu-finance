import { body, route } from "@/lib/api";
import { outlaySchema } from "@/lib/validation/schemas";
import { adminRecordOutlay } from "@/application/outlay/outlay";

/** Admin: Auslage / Gutschrift für den Mitarbeiter (Firma schuldet ihm den Betrag) */
export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  adminRecordOutlay(ctx, params.id, await body(req, outlaySchema)));
