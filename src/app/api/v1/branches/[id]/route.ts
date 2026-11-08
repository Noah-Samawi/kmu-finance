import { body, route } from "@/lib/api";
import { branchUpdateSchema } from "@/lib/validation/schemas";
import { updateBranch } from "@/application/branches/branches";

/** Filiale umbenennen / deaktivieren: { name?, city?, isActive? } */
export const PATCH = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  return updateBranch(ctx, params.id, await body(req, branchUpdateSchema));
});
