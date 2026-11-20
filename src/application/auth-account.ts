import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/infrastructure/db/client";
import { users } from "@/infrastructure/db/schema";
import {
  destroyAllSessionsOfUser, hashPassword, verifyPassword,
} from "@/infrastructure/auth/session";
import { conflict, notFound, rule, unauthorized } from "@/domain/errors";
import { passwordSchema } from "@/lib/validation/schemas";
import type { Ctx } from "./context";
import { requireRole } from "./context";

export const changeEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  currentPassword: z.string().min(1).max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

function assertOwner(ctx: Ctx) {
  requireRole(ctx, "ADMIN");
  if (ctx.role === "COMPANY_ADMIN") throw rule("Nur der Konto-Inhaber kann Kontoeinstellungen ändern");
}

export async function getAccountProfile(ctx: Ctx) {
  assertOwner(ctx);
  const u = await db.query.users.findFirst({
    where: eq(users.id, ctx.userId),
    columns: { id: true, email: true, name: true, role: true, totpEnabled: true },
  });
  if (!u) throw notFound("Benutzer");
  return u;
}

export async function changeOwnEmail(ctx: Ctx, input: z.infer<typeof changeEmailSchema>) {
  assertOwner(ctx);
  const u = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
  if (!u) throw notFound("Benutzer");
  if (!(await verifyPassword(input.currentPassword, u.passwordHash))) {
    throw unauthorized("Aktuelles Passwort ist falsch");
  }
  if (input.email === u.email) return { ok: true as const, email: u.email };

  if (await db.query.users.findFirst({ where: eq(users.email, input.email) })) {
    throw conflict("E-Mail ist bereits vergeben");
  }
  await db.update(users).set({ email: input.email }).where(eq(users.id, u.id));
  return { ok: true as const, email: input.email };
}

export async function changeOwnPassword(ctx: Ctx, input: z.infer<typeof changePasswordSchema>) {
  assertOwner(ctx);
  const u = await db.query.users.findFirst({ where: eq(users.id, ctx.userId) });
  if (!u) throw notFound("Benutzer");
  if (!(await verifyPassword(input.currentPassword, u.passwordHash))) {
    throw unauthorized("Aktuelles Passwort ist falsch");
  }
  if (input.currentPassword === input.newPassword) {
    throw rule("Neues Passwort muss sich vom aktuellen unterscheiden");
  }
  await db.update(users).set({ passwordHash: await hashPassword(input.newPassword) }).where(eq(users.id, u.id));
  await destroyAllSessionsOfUser(u.id);
  return { ok: true as const, message: "Passwort geändert. Bitte erneut anmelden." };
}
