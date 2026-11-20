import { route } from "@/lib/api";
import { totpStatus } from "@/application/auth-totp";

export const GET = route(["ADMIN"], async ({ ctx }) => totpStatus(ctx));
