import { route } from "@/lib/api";
import { employeeOverview } from "@/application/dashboard";

/** Mitarbeiter: eigenes Guthaben, Tages-/Monatswerte, letzte Buchungen */
export const GET = route(["EMPLOYEE"], async ({ ctx }) => employeeOverview(ctx));
