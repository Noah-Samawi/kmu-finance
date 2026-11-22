import { body, route } from "@/lib/api";
import { z } from "zod";
import { purgeBelege, restoreBelege, trashBelege } from "@/application/belege/belege";

export const runtime = "nodejs";

const bulkSchema = z.object({
  action: z.enum(["trash", "restore", "purge"]),
  ids: z.array(z.string().min(1)).min(1).max(200),
});

export const POST = route(["ADMIN"], async ({ req, ctx }) => {
  const { action, ids } = await body(req, bulkSchema);
  if (action === "trash") return trashBelege(ctx, ids);
  if (action === "restore") return restoreBelege(ctx, ids);
  return purgeBelege(ctx, ids);
});
