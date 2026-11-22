import { route } from "@/lib/api";
import { getBeleg, runBelegOcr } from "@/application/belege/belege";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = route<{ id: string }>(["ADMIN"], async ({ ctx, params }) => {
  await runBelegOcr(ctx, params.id);
  return getBeleg(ctx, params.id);
});
