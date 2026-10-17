import { body, route } from "@/lib/api";
import { balanceCorrectionSchema } from "@/lib/validation/schemas";
import { correctBalance } from "@/application/cash/cash";

/** Bestandskorrektur zum Stichtag: { accountKind, date, actualCents, description } – bucht nur die Differenz */
export const POST = route(["ADMIN"], async ({ req, ctx }) => correctBalance(ctx, await body(req, balanceCorrectionSchema)));
