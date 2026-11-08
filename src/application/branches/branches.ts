// Filialen / Standorte: Konten laufen zentral (Kasse & Bank), jede Buchung kann einer Filiale zugeordnet werden.
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/infrastructure/db/client";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { branches } from "@/infrastructure/db/schema";
import { conflict, notFound } from "@/domain/errors";
import { branchFigures } from "@/domain/branch";
import { filterLedgerRows, type LedgerFilter } from "@/domain/ledger-filter";
import { branchSchema, branchUpdateSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import { audit } from "../ledger-service";
import { ledgerRows, rangeFromDays } from "../reports/reports";

export interface Branch { id: string; name: string; city: string | null; isActive: boolean }

/** Alle Rollen des Mandanten (Mitarbeiter wählen die Filiale beim Beleg-Upload) */
export async function listBranches(ctx: Ctx, { activeOnly = false } = {}): Promise<Branch[]> {
  requireRole(ctx, "ADMIN", "EMPLOYEE", "PARTNER");
  const tenantId = tid(ctx);
  return withTenant(ctx, (tx) => tx.select({ id: branches.id, name: branches.name, city: branches.city, isActive: branches.isActive })
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), activeOnly ? eq(branches.isActive, true) : undefined))
    .orderBy(asc(branches.name)));
}

async function assertUniqueName(tx: Tx, tenantId: string, name: string, exceptId?: string) {
  const dup = await tx.query.branches.findFirst({
    where: and(eq(branches.tenantId, tenantId), sql`lower(${branches.name}) = lower(${name})`),
  });
  if (dup && dup.id !== exceptId) throw conflict(`Filiale „${name}“ gibt es bereits`);
}

export async function createBranch(ctx: Ctx, input: z.infer<typeof branchSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await assertUniqueName(tx, tenantId, input.name);
    const [b] = await tx.insert(branches).values({ tenantId, name: input.name, city: input.city }).returning();
    await audit(tx, ctx, "branch.created", "Branch", b.id, { name: b.name, city: b.city });
    return { branch: b };
  });
}

export async function updateBranch(ctx: Ctx, id: string, input: z.infer<typeof branchUpdateSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const b = await tx.query.branches.findFirst({ where: and(eq(branches.id, id), eq(branches.tenantId, tenantId)) });
    if (!b) throw notFound("Filiale");
    if (input.name) await assertUniqueName(tx, tenantId, input.name, id);
    const [u] = await tx.update(branches).set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.city !== undefined && { city: input.city }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    }).where(eq(branches.id, id)).returning();
    await audit(tx, ctx, "branch.updated", "Branch", id, { before: { name: b.name, city: b.city, isActive: b.isActive }, after: input });
    return { branch: u };
  });
}

/** Auswertung je Filiale (oder "none" = ohne Filiale) – Umsätze Bar/Bank, Kosten nach Kategorie, Bewegungen */
export async function branchReport(ctx: Ctx, branchId: string, from: string, to: string, filter: LedgerFilter = {}) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const range = rangeFromDays(from, to);
  return withTenant(ctx, async (tx) => {
    const branch = branchId === "none" ? null
      : await tx.query.branches.findFirst({ where: and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)) });
    if (branchId !== "none" && !branch) throw notFound("Filiale");
    const rows = await ledgerRows(tx, tenantId, { range, branchId, limit: 20_000 });
    return { branch, from, to, figures: branchFigures(rows), entries: filterLedgerRows(rows, filter) };
  });
}

/** Kennzahlen aller Filialen für den Zeitraum (Übersichtstabelle) */
export async function branchOverview(ctx: Ctx, from: string, to: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const range = rangeFromDays(from, to);
  return withTenant(ctx, async (tx) => {
    const list = await tx.select().from(branches).where(eq(branches.tenantId, tenantId)).orderBy(asc(branches.name));
    const rows = await ledgerRows(tx, tenantId, { range, limit: 50_000 });
    const by = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.branchId ?? "none";
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return {
      branches: list.map((b) => ({ ...b, figures: branchFigures(by.get(b.id) ?? []) })),
      unassigned: branchFigures(by.get("none") ?? []),
      total: branchFigures(rows),
    };
  });
}
