// Super-Admin: Mandanten (Kunden-Firmen) verwalten
import { randomInt } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/infrastructure/db/client";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { auditLogs, tenants, users } from "@/infrastructure/db/schema";
import { destroyAllSessionsOfUser, hashPassword } from "@/infrastructure/auth/session";
import { resetLogin } from "@/infrastructure/auth/rate-limit";
import { conflict, notFound, rule } from "@/domain/errors";
import {
  tenantAdminPasswordSchema, tenantCreateSchema, tenantDeleteSchema, tenantUpdateSchema,
} from "@/lib/validation/schemas";
import { requireRole, type Ctx } from "../context";

export async function listTenants(ctx: Ctx) {
  requireRole(ctx, "SUPER_ADMIN");
  return db
    .select({
      id: tenants.id, name: tenants.name, slug: tenants.slug, status: tenants.status,
      legalName: tenants.legalName, street: tenants.street, zip: tenants.zip,
      city: tenants.city, createdAt: tenants.createdAt,
      taxNumber: tenants.taxNumber, vatId: tenants.vatId, iban: tenants.iban, bic: tenants.bic,
      smallBusiness: tenants.smallBusiness,
      userCount: sql<number>`(select count(*)::int from "User" u where u."tenantId" = "Tenant"."id")`,
      adminEmail: sql<string | null>`(select u.email from "User" u where u."tenantId" = "Tenant"."id" and u.role = 'ADMIN' order by u."createdAt" limit 1)`,
      adminName: sql<string | null>`(select u.name from "User" u where u."tenantId" = "Tenant"."id" and u.role = 'ADMIN' order by u."createdAt" limit 1)`,
    })
    .from(tenants)
    .orderBy(desc(tenants.createdAt));
}

export async function getTenant(ctx: Ctx, id: string) {
  requireRole(ctx, "SUPER_ADMIN");
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, id) });
  if (!t) throw notFound("Mandant");
  return t;
}

/** Eigene Firmendaten (für Admin/Mitarbeiter) */
export async function getOwnTenant(ctx: Ctx) {
  requireRole(ctx, "ADMIN", "EMPLOYEE", "PARTNER");
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId ?? "") });
  if (!t) throw notFound("Mandant");
  return t;
}

/** Legt Firma + ersten Admin (Geschäftsführer) in einer Transaktion an */
export async function createTenant(ctx: Ctx, input: z.infer<typeof tenantCreateSchema>) {
  requireRole(ctx, "SUPER_ADMIN");
  const { admin, ...data } = input;
  return db.transaction(async (tx) => {
    if (await tx.query.tenants.findFirst({ where: eq(tenants.slug, data.slug) })) {
      throw conflict("Slug ist bereits vergeben");
    }
    if (await tx.query.users.findFirst({ where: eq(users.email, admin.email) })) {
      throw conflict("E-Mail ist bereits registriert");
    }
    const [t] = await tx.insert(tenants).values(data).returning();
    const [u] = await tx.insert(users).values({
      tenantId: t.id, email: admin.email, name: admin.name, role: "ADMIN",
      passwordHash: await hashPassword(admin.password),
    }).returning({ id: users.id });
    await tx.insert(auditLogs).values({
      tenantId: t.id, actorId: ctx.userId, action: "tenant.created", entity: "Tenant", entityId: t.id,
      meta: { adminUserId: u.id },
    });
    return t;
  });
}

/** Stammdaten ändern oder sperren/entsperren. Sperre wirkt sofort (Session-Check). */
export async function updateTenant(ctx: Ctx, id: string, input: z.infer<typeof tenantUpdateSchema>) {
  requireRole(ctx, "SUPER_ADMIN");
  const [t] = await db.update(tenants).set(input).where(eq(tenants.id, id)).returning();
  if (!t) throw notFound("Mandant");
  await db.insert(auditLogs).values({
    tenantId: id, actorId: ctx.userId, action: input.status ? `tenant.${input.status.toLowerCase()}` : "tenant.updated",
    entity: "Tenant", entityId: id, meta: input,
  });
  return t;
}

// Ohne leicht verwechselbare Zeichen (0/O, 1/l/I)
const PW_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function generatePassword(length = 14): string {
  let pw = "";
  for (let i = 0; i < length; i++) pw += PW_CHARS[randomInt(PW_CHARS.length)];
  return pw;
}

/**
 * Setzt das Passwort des ersten Admins (Geschäftsführers) der Firma neu.
 * Ohne Angabe wird ein zufälliges Passwort erzeugt. Alle Sitzungen des Admins enden sofort.
 * Das Passwort steht nie im Audit-Log.
 */
export async function resetTenantAdminPassword(ctx: Ctx, tenantId: string, input: z.infer<typeof tenantAdminPasswordSchema>) {
  requireRole(ctx, "SUPER_ADMIN");
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { id: true } });
  if (!t) throw notFound("Mandant");
  const admin = await db.query.users.findFirst({
    where: and(eq(users.tenantId, tenantId), eq(users.role, "ADMIN")),
    orderBy: asc(users.createdAt),
  });
  if (!admin) throw notFound("Admin dieser Firma");
  const password = input.password ?? generatePassword();
  await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, admin.id));
  await destroyAllSessionsOfUser(admin.id);
  resetLogin(admin.email.toLowerCase());
  await db.insert(auditLogs).values({
    tenantId, actorId: ctx.userId, action: "tenant.admin_password_reset", entity: "User", entityId: admin.id,
    meta: { email: admin.email, generated: input.password === undefined },
  });
  return { adminEmail: admin.email, adminName: admin.name, password };
}

/**
 * Firma komplett entfernen (Filialen, Buchungen, Belege, Rechnungen, Benutzer, Sitzungen, Protokoll).
 * Sicherheitsbestätigung: Kurzname der Firma oder "LÖSCHEN". Der Löschvorgang selbst läuft in der
 * DB-Funktion purge_tenant (Hauptbuch ist sonst append-only). Das Löschprotokoll bleibt ohne Mandantenbezug erhalten.
 */
export async function deleteTenant(ctx: Ctx, tenantId: string, input: z.infer<typeof tenantDeleteSchema>) {
  requireRole(ctx, "SUPER_ADMIN");
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!t) throw notFound("Mandant");
  const typed = input.confirm.trim();
  if (typed.toLowerCase() !== t.slug.toLowerCase() && typed.toLocaleUpperCase("de-DE") !== "LÖSCHEN") {
    throw rule(`Bestätigung falsch: bitte den Kurznamen „${t.slug}“ oder „LÖSCHEN“ eingeben`);
  }
  const userCount = (await db.select({ n: sql<number>`count(*)::int` }).from(users).where(eq(users.tenantId, tenantId)))[0].n;
  await withTenant(ctx, async (tx) => {
    await tx.execute(sql`select purge_tenant(${tenantId})`);
    await tx.insert(auditLogs).values({
      tenantId: null, actorId: ctx.userId, action: "tenant.deleted", entity: "Tenant", entityId: tenantId,
      meta: { name: t.name, slug: t.slug, users: userCount },
    });
  });
  return { deleted: true, name: t.name, slug: t.slug };
}
