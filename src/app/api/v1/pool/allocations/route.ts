import { body, route } from "@/lib/api";
import { allocationSchema } from "@/lib/validation/schemas";
import { allocateBudget } from "@/application/pool/pool";

/** Budget an Mitarbeiter: { employeeId, amountCents, description? } – blockiert bei zu wenig Pool */
export const POST = route(["ADMIN"], async ({ req, ctx }) => allocateBudget(ctx, await body(req, allocationSchema)));
