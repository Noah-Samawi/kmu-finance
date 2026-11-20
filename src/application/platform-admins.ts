import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/infrastructure/db/client";
import { auditLogs, users } from "@/infrastructure/db/schema";
import { hashPassword } from "@/infrastructure/auth/session";
import { conflict, rule } from "@/domain/errors";
import { passwordSchema } from "@/lib/validation/schemas";
import { requireRole, type Ctx } from "./context";
import { generatePassword } from "./tenants/tenants";

export const createPlatformAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(120),
  password: passwordSchema.optional(),
});

export async function listPlatformAdmins(ctx: Ctx) {
  requireRole(ctx, "SUPER_ADMIN");
  return db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.isActive,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(eq(users.role, "SUPER_ADMIN"))
    .orderBy(asc(users.createdAt));
}

/** Weiteren Platform-Admin (SUPER_ADMIN) anlegen – beide können /super nutzen */
export async function createPlatformAdmin(ctx: Ctx, input: z.infer<typeof createPlatformAdminSchema>) {
  requireRole(ctx, "SUPER_ADMIN");
  const email = input.email;
  if (await db.query.users.findFirst({ where: eq(users.email, email) })) {
    throw conflict("E-Mail ist bereits registriert");
  }
  if (ctx.role !== "SUPER_ADMIN") throw rule("Nur Platform-Admins dürfen weitere anlegen");

  const password = input.password ?? generatePassword(14);
  const [u] = await db.insert(users).values({
    email,
    name: input.name,
    role: "SUPER_ADMIN",
    tenantId: null,
    passwordHash: await hashPassword(password),
    isActive: true,
    canLogin: true,
  }).returning({ id: users.id, email: users.email, name: users.name });

  await db.insert(auditLogs).values({
    tenantId: null,
    actorId: ctx.userId,
    action: "platform_admin.created",
    entity: "User",
    entityId: u.id,
    meta: { email: u.email },
  });

  return { admin: u, password };
}
