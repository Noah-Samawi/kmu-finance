import { NextResponse } from "next/server";
import { body, route } from "@/lib/api";
import { loginSchema } from "@/lib/validation/schemas";
import { login } from "@/application/auth";
import { SESSION_COOKIE } from "@/infrastructure/auth/session";
import { TOTP_CHALLENGE_COOKIE } from "@/infrastructure/auth/totp";

export const POST = route("public", async ({ req }) => {
  const { email, password } = await body(req, loginSchema);
  const result = await login(email, password);

  if (result.kind === "totp") {
    const res = NextResponse.json({
      requiresTotp: true,
      user: { name: result.user.name },
    });
    res.cookies.set(TOTP_CHALLENGE_COOKIE, result.challenge, {
      httpOnly: true, sameSite: "lax", path: "/",
      secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
      maxAge: 5 * 60,
    });
    return res;
  }

  const res = NextResponse.json({
    user: result.user,
    redirectTo: result.redirectTo,
  });
  res.cookies.set(SESSION_COOKIE, result.session.token, {
    httpOnly: true, sameSite: "lax", path: "/",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    expires: result.session.expiresAt,
  });
  res.cookies.delete(TOTP_CHALLENGE_COOKIE);
  return res;
});
