import { body, route } from "@/lib/api";
import { dailyIncomeSchema } from "@/lib/validation/schemas";
import { recordDailyIncome } from "@/application/cash/cash";

/** Tageseinnahme: { bookingDate, cashCents?, bankCents?, description, personId? } – Kasse + Bank als eine Bewegung */
export const POST = route(["ADMIN"], async ({ req, ctx }) => recordDailyIncome(ctx, await body(req, dailyIncomeSchema)));
