import { route } from "@/lib/api";
import { totpStatus } from "@/application/auth-totp";

export const GET = route(["SUPER_ADMIN", "ADMIN"], async ({ ctx }) => totpStatus(ctx));
