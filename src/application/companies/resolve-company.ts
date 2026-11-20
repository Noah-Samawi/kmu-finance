import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/infrastructure/db/client";
import { branches, companies } from "@/infrastructure/db/schema";
import { notFound, rule } from "@/domain/errors";

/** Erste / einzige Company eines Tenants (Phase 3: 1 Tenant ≈ 1 Company) */
export async function defaultCompanyId(tx: Tx, tenantId: string): Promise<string> {
  const c = await tx.query.companies.findFirst({
    where: and(eq(companies.tenantId, tenantId), eq(companies.isActive, true)),
    orderBy: [asc(companies.createdAt)],
    columns: { id: true },
  });
  if (!c) throw rule("Keine Firma (Company) für diesen Mandanten – bitte Support kontaktieren");
  return c.id;
}

/** companyId aus Filiale oder Default-Company des Tenants */
export async function resolveCompanyId(
  tx: Tx, tenantId: string, branchId?: string | null, explicit?: string | null,
): Promise<string> {
  if (explicit) {
    const c = await tx.query.companies.findFirst({
      where: and(eq(companies.id, explicit), eq(companies.tenantId, tenantId)),
      columns: { id: true },
    });
    if (!c) throw notFound("Firma");
    return c.id;
  }
  if (branchId) {
    const b = await tx.query.branches.findFirst({
      where: and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)),
      columns: { companyId: true },
    });
    if (!b) throw notFound("Filiale");
    if (b.companyId) return b.companyId;
  }
  return defaultCompanyId(tx, tenantId);
}
