import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, SESSION_COOKIE, type AuthUser } from "@/infrastructure/auth/session";
import type { Role } from "@/infrastructure/db/schema";

/** Für Server Components: aktuellen Benutzer laden oder zum Login umleiten */
export async function requireUser(...roles: Role[]): Promise<AuthUser> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await resolveSession(token);
  if (!user) redirect("/login");
  if (roles.length && !roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

export function homeFor(role: Role) {
  return role === "SUPER_ADMIN" ? "/super/tenants" : role === "ADMIN" ? "/admin/dashboard" : "/me";
}
