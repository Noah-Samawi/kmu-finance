import { body, route } from "@/lib/api";
import { belegBookSchema, bookBeleg } from "@/application/belege/belege";

export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) =>
  bookBeleg(ctx, params.id, await body(req, belegBookSchema)));
