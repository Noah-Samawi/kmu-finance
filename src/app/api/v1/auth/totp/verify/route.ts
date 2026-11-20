import { NextResponse } from "next/server";
import { body, route } from "@/lib/api";
import { completeTotpLogin, totpCodeSchema } from "@/application/auth-totp";
import { SESSION_COOKIE } from "@/infrastructure/auth/session";
import { TOTP_CHALLENGE_COOKIE } from "@/infrastructure/auth/totp";

export const POST = route("public", async ({ req }) => {
  const { code } = await body(req, totpCodeSchema);
  const challenge = req.cookies.get(TOTP_CHALLENGE_COOKIE)?.value;
  const { session, user, redirectTo } = await completeTotpLogin(challenge ?? "", code);

  const res = NextResponse.json({ user, redirectTo });
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true, sameSite: "lax", path: "/",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    expires: session.expiresAt,
  });
  res.cookies.delete(TOTP_CHALLENGE_COOKIE);
  return res;
});
