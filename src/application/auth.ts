import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { tenants, users } from "@/infrastructure/db/schema";
import { createSession, verifyPassword } from "@/infrastructure/auth/session";
import { checkLoginAllowed, recordLoginFailure, resetLogin } from "@/infrastructure/auth/rate-limit";
import { AppError, unauthorized } from "@/domain/errors";

// Gleicher Hash-Aufwand auch bei unbekannter E-Mail -> kein Timing-Leak
const DUMMY_HASH = "$2b$12$1YavV8u5dGvRsNe2G6LPN.NTGE.FpFZFmJErBdNFh5MvpAZ4R7FQ6";

export async function login(email: string, password: string) {
  const key = email.toLowerCase();
  if (!checkLoginAllowed(key)) {
    throw new AppError(429, "TOO_MANY_ATTEMPTS", "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.");
  }
  const rows = await db
    .select({ user: users, tenantStatus: tenants.status })
    .from(users)
    .leftJoin(tenants, eq(tenants.id, users.tenantId))
    .where(eq(users.email, key))
    .limit(1);
  const r = rows[0];
  const ok = await verifyPassword(password, r?.user.passwordHash ?? DUMMY_HASH);
  if (!r || !ok) {
    recordLoginFailure(key);
    throw unauthorized("E-Mail oder Passwort falsch");
  }
  if (!r.user.isActive) throw new AppError(403, "USER_LOCKED", "Dein Zugang ist gesperrt. Bitte wende dich an die Geschäftsführung.");
  if (r.user.role !== "SUPER_ADMIN" && r.tenantStatus !== "ACTIVE") {
    throw new AppError(403, "TENANT_SUSPENDED", "Der Firmen-Account ist gesperrt.");
  }
  resetLogin(key);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, r.user.id));
  const session = await createSession(r.user.id);
  return { session, user: { id: r.user.id, name: r.user.name, role: r.user.role } };
}
