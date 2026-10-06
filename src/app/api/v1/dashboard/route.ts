import { route } from "@/lib/api";
import { adminDashboard } from "@/application/dashboard";

export const GET = route(["ADMIN"], async ({ ctx }) => adminDashboard(ctx));
