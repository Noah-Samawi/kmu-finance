import { body, route } from "@/lib/api";
import { branchUpdateSchema } from "@/lib/validation/schemas";
import { deleteBranch, updateBranch } from "@/application/branches/branches";

/** Filiale umbenennen / deaktivieren: { name?, city?, isActive? } */
export const PATCH = route<{ id: string }>(["ADMIN"], async ({ req, ctx, params }) => {
  return updateBranch(ctx, params.id, await body(req, branchUpdateSchema));
});

/** Leer: löschen. Mit Buchungen: als inaktiv archivieren. */
export const DELETE = route<{ id: string }>(["ADMIN"], async ({ ctx, params }) => deleteBranch(ctx, params.id));
