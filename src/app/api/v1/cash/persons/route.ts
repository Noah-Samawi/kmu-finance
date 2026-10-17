import { route } from "@/lib/api";
import { listPersons } from "@/application/cash/cash";

/** Auswahlliste "Person zuordnen" (Mitarbeiter / Partner / Gesellschafter) */
export const GET = route(["ADMIN"], async ({ ctx }) => ({ persons: await listPersons(ctx) }));
