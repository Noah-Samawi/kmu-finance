import { route } from "@/lib/api";
import { getPersonnelFile } from "@/application/hr/hr";

export const GET = route(["EMPLOYEE"], async ({ ctx }) => getPersonnelFile(ctx, ctx.userId));
