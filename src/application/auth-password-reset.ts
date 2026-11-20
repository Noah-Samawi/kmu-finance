import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/infrastructure/db/client";
import { passwordResetTokens, users } from "@/infrastructure/db/schema";
import { destroyAllSessionsOfUser, hashPassword } from "@/infrastructure/auth/session";
import { randomToken } from "@/infrastructure/auth/totp";
import { appBaseUrl, sendEmail } from "@/infrastructure/email/send";
import { rule } from "@/domain/errors";
import { passwordSchema } from "@/lib/validation/schemas";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const RESET_TTL_MS = 60 * 60_000; // 1 Stunde

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

function canSelfReset(role: string) {
  return role === "TENANT_OWNER" || role === "ADMIN";
}

/**
 * Reset-Link nur für Superuser (TENANT_OWNER / legacy ADMIN).
 * Antwort immer gleich – kein User-Enumeration.
 */
export async function requestPasswordReset(email: string) {
  const generic = { ok: true as const, message: "Wenn ein Konto existiert, wurde eine E-Mail gesendet." };
  const u = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!u || !canSelfReset(u.role) || !u.isActive || u.canLogin === false) return generic;

  const token = randomToken(32);
  await db.insert(passwordResetTokens).values({
    userId: u.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });

  const link = `${appBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: u.email,
    subject: "Passwort zurücksetzen – Kassenbuch",
    text: [
      `Hallo ${u.name},`,
      "",
      "Du hast ein Zurücksetzen deines Passworts angefordert.",
      `Link (1 Stunde gültig): ${link}`,
      "",
      "Falls du das nicht warst, ignoriere diese E-Mail.",
    ].join("\n"),
  });

  return generic;
}

export async function resetPasswordWithToken(token: string, password: string) {
  const hash = sha256(token);
  const row = await db.query.passwordResetTokens.findFirst({
    where: and(
      eq(passwordResetTokens.tokenHash, hash),
      isNull(passwordResetTokens.usedAt),
      gt(passwordResetTokens.expiresAt, new Date()),
    ),
  });
  if (!row) throw rule("Link ungültig oder abgelaufen");

  const u = await db.query.users.findFirst({ where: eq(users.id, row.userId) });
  if (!u || !canSelfReset(u.role)) throw rule("Link ungültig oder abgelaufen");

  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, u.id));
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
  await destroyAllSessionsOfUser(u.id);

  return { ok: true as const, message: "Passwort gespeichert. Du kannst dich jetzt anmelden." };
}
