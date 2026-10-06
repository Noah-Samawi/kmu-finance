import { route } from "@/lib/api";
import { poolOverview } from "@/application/pool/pool";

/** Rest-Kassenbestand + letzte Pool-Bewegungen */
export const GET = route(["ADMIN"], async ({ ctx }) => poolOverview(ctx));
