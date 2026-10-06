import { NextResponse } from "next/server";
import { body, route } from "@/lib/api";
import { loginSchema } from "@/lib/validation/schemas";
import { login } from "@/application/auth";
import { SESSION_COOKIE } from "@/infrastructure/auth/session";
import { homeFor } from "@/lib/auth";

export const POST = route("public", async ({ req }) => {
  const { email, password } = await body(req, loginSchema);
  const { session, user } = await login(email, password);
  const res = NextResponse.json({ user, redirectTo: homeFor(user.role) });
  res.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true, sameSite: "lax", path: "/",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    expires: session.expiresAt,
  });
  return res;
});
