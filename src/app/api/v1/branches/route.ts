import { body, route } from "@/lib/api";
import { branchSchema } from "@/lib/validation/schemas";
import { createBranch, listBranches } from "@/application/branches/branches";

export const GET = route(["ADMIN", "EMPLOYEE", "PARTNER"], async ({ ctx }) => ({ branches: await listBranches(ctx) }));

/** Filiale anlegen: { name, city? } */
export const POST = route(["ADMIN"], async ({ req, ctx }) => createBranch(ctx, await body(req, branchSchema)));
