import { and, eq } from "drizzle-orm";
import type { Tx } from "@/infrastructure/db/client";
import { branches } from "@/infrastructure/db/schema";
import { notFound, rule } from "@/domain/errors";

/** Filiale prüfen (gehört zum Mandanten, aktiv). Leer = keine Filiale. */
export async function assertBranch(tx: Tx, tenantId: string, branchId?: string | null): Promise<string | null> {
  if (!branchId) return null;
  const b = await tx.query.branches.findFirst({ where: and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)) });
  if (!b) throw notFound("Filiale");
  if (!b.isActive) throw rule(`Filiale ${b.name} ist deaktiviert`);
  return b.id;
}
