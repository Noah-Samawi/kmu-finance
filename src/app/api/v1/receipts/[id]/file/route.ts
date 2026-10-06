import { fileResponse, route } from "@/lib/api";
import { getReceiptFile } from "@/application/receipts/receipts";

/** Belegfoto anzeigen (Mitarbeiter nur eigene) */
export const GET = route<{ id: string }>(["ADMIN", "EMPLOYEE"], async ({ ctx, params }) => {
  const f = await getReceiptFile(ctx, params.id);
  return fileResponse(f.data, f.mime, f.name, true);
});
