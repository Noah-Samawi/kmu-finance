import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/infrastructure/db/client";
import { auditLogs, tenants } from "@/infrastructure/db/schema";
import { notFound } from "@/domain/errors";
import { letterheadSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";

export async function getLetterhead(ctx: Ctx) {
  requireRole(ctx, "ADMIN");
  const t = await db.query.tenants.findFirst({ where: eq(tenants.id, tid(ctx)) });
  if (!t) throw notFound("Mandant");
  return t;
}

export async function updateLetterhead(ctx: Ctx, input: z.infer<typeof letterheadSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const patch: Partial<typeof tenants.$inferInsert> = {};
  const keys = [
    "legalName", "street", "zip", "city", "taxNumber", "vatId", "iban", "bic",
    "invoicePrefix", "defaultPaymentDays", "invoiceFooter", "defaultPaymentMethod",
  ] as const;
  for (const k of keys) {
    if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
  }
  if (input.logoDataUrl !== undefined) patch.logoKey = input.logoDataUrl || null;
  const [t] = await db.update(tenants).set(patch).where(eq(tenants.id, tenantId)).returning();
  if (!t) throw notFound("Mandant");
  await db.insert(auditLogs).values({
    tenantId, actorId: ctx.userId, action: "tenant.letterhead", entity: "Tenant", entityId: tenantId,
  });
  return t;
}
