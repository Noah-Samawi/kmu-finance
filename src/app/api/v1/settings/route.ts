import { body, route } from "@/lib/api";
import { letterheadSchema } from "@/lib/validation/schemas";
import { getLetterhead, updateLetterhead } from "@/application/settings/settings";

export const GET = route(["ADMIN"], async ({ ctx }) => getLetterhead(ctx));

export const PUT = route(["ADMIN"], async ({ req, ctx }) =>
  updateLetterhead(ctx, await body(req, letterheadSchema)));
