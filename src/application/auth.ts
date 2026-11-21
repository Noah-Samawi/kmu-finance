import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { tenants, users } from "@/infrastructure/db/schema";
import { createSession, verifyPassword } from "@/infrastructure/auth/session";
import { createTotpChallenge } from "@/infrastructure/auth/totp";
import { checkLoginAllowed, recordLoginFailure, resetLogin } from "@/infrastructure/auth/rate-limit";
import { AppError, unauthorized } from "@/domain/errors";
import { homeForRole, isAdminLike } from "@/domain/roles";

// Gleicher Hash-Aufwand auch bei unbekannter E-Mail -> kein Timing-Leak
const DUMMY_HASH = "$2b$12$1YavV8u5dGvRsNe2G6LPN.NTGE.FpFZFmJErBdNFh5MvpAZ4R7FQ6";

export type LoginResult =
  | {
      kind: "session";
      session: { token: string; expiresAt: Date };
      user: { id: string; name: string; role: string };
      redirectTo: string;
    }
  | {
      kind: "totp";
      challenge: string;
      user: { id: string; name: string; role: string };
    };

export async function login(email: string, password: string): Promise<LoginResult> {
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
  if (r.user.canLogin === false) {
    throw new AppError(403, "NO_LOGIN", "Für diesen Mitarbeiter ist kein Login eingerichtet. Bitte wende dich an die Geschäftsführung.");
  }
  if (r.user.role !== "SUPER_ADMIN" && r.tenantStatus && r.tenantStatus !== "ACTIVE" && r.tenantStatus !== "PENDING") {
    throw new AppError(403, "TENANT_SUSPENDED", "Dieses Firmenkonto ist gesperrt. Bitte wenden Sie sich an die Systemverwaltung.");
  }

  // 2FA für Platform-Admin + Tenant-Owner (nicht Restaurant-Mitarbeiter)
  const wantsTotp = r.user.totpEnabled && r.user.totpSecret
    && (r.user.role === "SUPER_ADMIN" || r.user.role === "TENANT_OWNER" || r.user.role === "ADMIN");
  if (wantsTotp) {
    resetLogin(key);
    return {
      kind: "totp",
      challenge: createTotpChallenge(r.user.id),
      user: { id: r.user.id, name: r.user.name, role: r.user.role },
    };
  }

  resetLogin(key);
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, r.user.id));
  const session = await createSession(r.user.id);
  const redirectTo = r.tenantStatus === "PENDING" && isAdminLike(r.user.role)
    ? "/pending"
    : homeForRole(r.user.role);
  return {
    kind: "session",
    session,
    user: { id: r.user.id, name: r.user.name, role: r.user.role },
    redirectTo,
  };
}
