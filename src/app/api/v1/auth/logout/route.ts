import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { destroySession, SESSION_COOKIE } from "@/infrastructure/auth/session";

export const POST = route("public", async ({ req }) => {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
