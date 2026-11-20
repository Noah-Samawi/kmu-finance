import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "../db/client";
import { memberships, sessions, tenants, users, type Role } from "../db/schema";

export const SESSION_COOKIE = "kmu_session";
const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 14);

export interface AuthUser {
  userId: string;
  tenantId: string | null;
  role: Role;
  name: string;
  email: string;
  tenantName: string | null;
  /** ACTIVE | PENDING | SUSPENDED | BLOCKED | null (SUPER_ADMIN) */
  tenantStatus: string | null;
  /** Company-Scope für COMPANY_ADMIN / EMPLOYEE; null = alle Companies (TENANT_OWNER) */
  companyId: string | null;
  canEnterCashExpense: boolean;
  canEnterOutlay: boolean;
  canViewReports: boolean;
  canViewBank: boolean;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

/** Erstellt eine Session. Der Klartext-Token geht nur ins Cookie, in der DB liegt der Hash. */
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt });
  // Abgelaufene Sessions nebenbei aufräumen
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date())));
  return { token, expiresAt };
}

/**
 * Löst einen Token zum Benutzer auf. Gibt null zurück, wenn
 * Session abgelaufen, Benutzer gesperrt oder Mandant gesperrt ist.
 * -> Sperren wirken sofort, nicht erst beim nächsten Login.
 */
export async function resolveSession(token: string | undefined | null): Promise<AuthUser | null> {
  if (!token) return null;
  const rows = await db
    .select({
      userId: users.id, tenantId: users.tenantId, role: users.role, name: users.name,
      email: users.email, isActive: users.isActive, canLogin: users.canLogin,
      canEnterCashExpense: users.canEnterCashExpense,
      canEnterOutlay: users.canEnterOutlay, canViewReports: users.canViewReports, canViewBank: users.canViewBank,
      tenantName: tenants.name, tenantStatus: tenants.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const r = rows[0];
  if (!r || !r.isActive || r.canLogin === false) return null;
  // BLOCKED / SUSPENDED → keine Session. PENDING darf nur die Warteseite sehen.
  if (r.role !== "SUPER_ADMIN" && r.tenantStatus && r.tenantStatus !== "ACTIVE" && r.tenantStatus !== "PENDING") {
    return null;
  }

  let companyId: string | null = null;
  if (r.tenantId && (r.role === "COMPANY_ADMIN" || r.role === "EMPLOYEE" || r.role === "PARTNER")) {
    const m = await db.query.memberships.findFirst({
      where: and(
        eq(memberships.userId, r.userId),
        eq(memberships.tenantId, r.tenantId),
        eq(memberships.isActive, true),
      ),
      columns: { companyId: true },
    });
    companyId = m?.companyId ?? null;
  }

  return {
    userId: r.userId, tenantId: r.tenantId, role: r.role, name: r.name,
    email: r.email, tenantName: r.tenantName, tenantStatus: r.tenantStatus ?? null, companyId,
    canEnterCashExpense: r.canEnterCashExpense,
    canEnterOutlay: r.canEnterOutlay, canViewReports: r.canViewReports, canViewBank: r.canViewBank,
  };
}

export async function destroySession(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function destroyAllSessionsOfUser(userId: string) {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
