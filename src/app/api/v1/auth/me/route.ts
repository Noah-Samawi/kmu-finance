import { route } from "@/lib/api";

export const GET = route(["SUPER_ADMIN", "ADMIN", "EMPLOYEE", "PARTNER"], async ({ ctx }) => ({ user: ctx }));
