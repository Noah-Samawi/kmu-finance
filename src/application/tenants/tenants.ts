// Super-Admin: Mandanten (Kunden-Firmen) verwalten
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/infrastructure/db/client";
import { auditLogs, tenants, users } from "@/infrastructure/db/schema";
import { hashPassword } from "@/infrastructure/auth/session";
import { conflict, notFound } from "@/domain/errors";
import { tenantCreateSchema, tenantUpdateSchema } from "@/lib/validation/schemas";
import { requireRole, type Ctx } from "../context";

export async function listTenants(ctx: Ctx) {
  requireRole(ctx, "SUPER_ADMIN");
  return db
    .select({
      id: tenants.id, name: tenants.name, slug: tenants.slug, status: tenants.status,
      city: tenants.city, createdAt: tenants.createdAt,
      userCount: sql<number>`(select count(*)::int from "User" u where u."tenantId" = ${tenants.id})`,
      adminEmail: sql<string | null>`(select u.email from "User" u where u."tenantId" = ${tenants.id} and u.role = 'ADMIN' order by u."createdAt" limit 1)`,
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
  requireRole(ctx, "ADMIN", "EMPLOYEE");
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
