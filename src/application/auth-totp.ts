import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/infrastructure/db/client";
import { tenants, users } from "@/infrastructure/db/schema";
import {
  generateTotpSecret, parseTotpChallenge, totpQrDataUrl, verifyTotp,
} from "@/infrastructure/auth/totp";
import { createSession } from "@/infrastructure/auth/session";
import { notFound, rule, unauthorized } from "@/domain/errors";
import { homeForRole } from "@/domain/roles";
import type { Ctx } from "./context";
import { requireRole } from "./context";

export const totpCodeSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "6-stelliger Code"),
});

export const totpConfirmSchema = z.object({
  secret: z.string().min(16).max(64),
  code: z.string().trim().regex(/^\d{6}$/, "6-stelliger Code"),
});

function assertTotpEligible(ctx: Ctx) {
  if (ctx.role === "SUPER_ADMIN") return;
  requireRole(ctx, "ADMIN"); // expandRoles → TENANT_OWNER
  if (ctx.role === "COMPANY_ADMIN") throw rule("2FA nur für den Konto-Inhaber");
}

/** Setup starten: Secret + QR (noch nicht aktiv) */
export async function beginTotpEnrollment(ctx: Ctx) {
  assertTotpEligible(ctx);
  const u = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
  if (!u) throw notFound("Benutzer");
  if (u.totpEnabled) throw rule("2FA ist bereits aktiv – zuerst deaktivieren");

  const secret = generateTotpSecret();
  const qrDataUrl = await totpQrDataUrl(u.email, secret);
  return {
    secret,
    qrDataUrl,
    otpauthUri: `otpauth://totp/Kassenbuch:${encodeURIComponent(u.email)}?secret=${secret}&issuer=Kassenbuch&digits=6&period=30`,
  };
}

/** Setup bestätigen mit erstem Code */
export async function confirmTotpEnrollment(ctx: Ctx, secret: string, code: string) {
  assertTotpEligible(ctx);
  if (!verifyTotp(secret, code)) throw rule("Code ungültig – App-Uhrzeit prüfen");
  await db.update(users).set({
    totpSecret: secret,
    totpEnabled: true,
    totpVerifiedAt: new Date(),
  }).where(eq(users.id, ctx.userId));
  return { ok: true as const, totpEnabled: true };
}

export async function disableTotp(ctx: Ctx, code: string) {
  assertTotpEligible(ctx);
  const u = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
  if (!u?.totpEnabled || !u.totpSecret) throw rule("2FA ist nicht aktiv");
  if (!verifyTotp(u.totpSecret, code)) throw rule("Code ungültig");
  await db.update(users).set({
    totpSecret: null,
    totpEnabled: false,
    totpVerifiedAt: null,
  }).where(eq(users.id, ctx.userId));
  return { ok: true as const, totpEnabled: false };
}

export async function totpStatus(ctx: Ctx) {
  assertTotpEligible(ctx);
  const u = await db.query.users.findFirst({
    where: eq(users.id, ctx.userId),
    columns: { totpEnabled: true, totpVerifiedAt: true },
  });
  return { totpEnabled: !!u?.totpEnabled, totpVerifiedAt: u?.totpVerifiedAt ?? null };
}

/** Zweiter Login-Schritt: Challenge-Cookie + Code → Session */
export async function completeTotpLogin(challengeToken: string, code: string) {
  const userId = parseTotpChallenge(challengeToken);
  if (!userId) throw unauthorized("Anmelde-Sitzung abgelaufen – bitte erneut anmelden");

  const rows = await db
    .select({ user: users, tenantStatus: tenants.status })
    .from(users)
    .leftJoin(tenants, eq(tenants.id, users.tenantId))
    .where(eq(users.id, userId))
    .limit(1);
  const r = rows[0];
  if (!r?.user || !r.user.totpEnabled || !r.user.totpSecret) throw unauthorized("2FA nicht aktiv");
  if (!(r.user.role === "SUPER_ADMIN" || r.user.role === "TENANT_OWNER" || r.user.role === "ADMIN")) {
    throw unauthorized();
  }
  if (!verifyTotp(r.user.totpSecret, code)) throw unauthorized("Code ungültig");

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, r.user.id));
  const session = await createSession(r.user.id);
  const redirectTo = r.tenantStatus === "PENDING" ? "/pending" : homeForRole(r.user.role);
  return {
    session,
    user: { id: r.user.id, name: r.user.name, role: r.user.role },
    redirectTo,
  };
}
