import { sql } from "drizzle-orm";
import { db, type Tx } from "./client";
import type { Role } from "./schema";

export interface DbContext {
  userId: string;
  tenantId: string | null;
  role: Role;
}

/**
 * Führt fn in einer Transaktion aus, in der die Postgres-Session-Variablen
 * für Row Level Security gesetzt sind. set_config(..., true) gilt nur
 * für diese Transaktion -> kein Durchsickern zwischen Requests im Pool.
 */
export function withTenant<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select set_config('app.tenant_id', ${ctx.tenantId ?? ""}, true),
             set_config('app.user_id',   ${ctx.userId}, true),
             set_config('app.role',      ${ctx.role}, true)`);
    return fn(tx);
  });
}

/**
 * Serialisiert alle Geldbewegungen eines Mandanten.
 * Verhindert, dass zwei gleichzeitige Zuteilungen denselben Pool-Euro
 * doppelt verteilen (Race Condition). Lock endet mit der Transaktion.
 */
export async function lockTenantLedger(tx: Tx, tenantId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"ledger:" + tenantId}))`);
}
