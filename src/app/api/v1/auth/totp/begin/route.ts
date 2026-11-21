import { route } from "@/lib/api";
import { beginTotpEnrollment } from "@/application/auth-totp";

export const POST = route(["SUPER_ADMIN", "ADMIN"], async ({ ctx }) => beginTotpEnrollment(ctx));
