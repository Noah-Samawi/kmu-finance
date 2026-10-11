import { notFound } from "@/domain/errors";
import { route } from "@/lib/api";
import { getBankStatement } from "@/application/bank/bank";

export const GET = route<{ id: string }>(["ADMIN"], async ({ ctx, params }) => {
  const data = await getBankStatement(ctx, params.id);
  if (!data) throw notFound("Kontoauszug");
  return data;
});
