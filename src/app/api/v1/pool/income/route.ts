import { body, route } from "@/lib/api";
import { incomeSchema } from "@/lib/validation/schemas";
import { recordIncome } from "@/application/pool/pool";

/** Manuelle Einnahme: { amountCents | "123,45", description, bookingDate? } */
export const POST = route(["ADMIN"], async ({ req, ctx }) => recordIncome(ctx, await body(req, incomeSchema)));
