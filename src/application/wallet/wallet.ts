// Modul C: Mitarbeiter-Konto – Ausgleich, Rückführung, Storno
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { ledgerEntries } from "@/infrastructure/db/schema";
import { notFound, rule } from "@/domain/errors";
import { DIRECTLY_REVERSIBLE, LEDGER_LABEL, deltasFor, reversalDeltas } from "@/domain/ledger";
import { adjustSchema, returnSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import { audit, insertEntry, insufficient, loadEmployee, poolBalance, walletBalance } from "../ledger-service";

/**
 * Manuelle Ausgleichsbuchung: Ausgabe ohne Beleg (z. B. Barzahlung ohne Quittung).
 * Senkt das Guthaben, "toZero" setzt es exakt auf 0,00 €.
 */
export async function adjustWallet(ctx: Ctx, employeeId: string, input: z.infer<typeof adjustSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const balance = await walletBalance(tx, tenantId, employeeId);
    const amount = input.toZero ? balance : input.amountCents!;
    if (amount <= 0) throw rule("Guthaben ist bereits 0,00 €");
    if (amount > balance) throw insufficient("Guthaben des Mitarbeiters", balance);
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "ADJUSTMENT", ...deltasFor("ADJUSTMENT", amount), employeeId, description: input.description,
    });
    await audit(tx, ctx, "wallet.adjustment", "LedgerEntry", entry.id, { employeeId, amountCents: amount });
    return { entry, walletBalanceCents: balance - amount };
  });
}

/** Restgeld vom Mitarbeiter zurück in den Pool */
export async function returnToPool(ctx: Ctx, employeeId: string, input: z.infer<typeof returnSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const emp = await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const balance = await walletBalance(tx, tenantId, employeeId);
    const amount = input.all ? balance : input.amountCents!;
    if (amount <= 0) throw rule("Kein Guthaben vorhanden");
    if (amount > balance) throw insufficient("Guthaben des Mitarbeiters", balance);
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "RETURN", ...deltasFor("RETURN", amount), employeeId,
      description: input.description || `Rückführung von ${emp.name}`,
    });
    await audit(tx, ctx, "wallet.return", "LedgerEntry", entry.id, { employeeId, amountCents: amount });
    return { entry, walletBalanceCents: balance - amount, poolBalanceCents: await poolBalance(tx, tenantId) };
  });
}

/**
 * Fehlbuchung stornieren (negierte Gegenbuchung).
 * Kein Konto darf dadurch negativ werden.
 */
export async function reverseEntry(ctx: Ctx, entryId: string, reason: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const orig = await tx.query.ledgerEntries.findFirst({
      where: and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.tenantId, tenantId)),
    });
    if (!orig) throw notFound("Buchung");
    if (!DIRECTLY_REVERSIBLE.includes(orig.type)) {
      throw rule(`${LEDGER_LABEL[orig.type]} kann hier nicht storniert werden (Rechnung stornieren bzw. Beleg ablehnen)`);
    }
    const already = await tx.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.reversalOfId, entryId) });
    if (already) throw rule("Buchung wurde bereits storniert");

    const d = reversalDeltas(orig);
    const pool = await poolBalance(tx, tenantId);
    if (pool + d.poolDeltaCents < 0) throw insufficient("Freier Kassenbestand", pool);
    if (orig.employeeId) {
      const w = await walletBalance(tx, tenantId, orig.employeeId);
      if (w + d.walletDeltaCents < 0) throw insufficient("Guthaben des Mitarbeiters", w);
    }
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "REVERSAL", ...d, employeeId: orig.employeeId, reversalOfId: orig.id,
      description: `Storno: ${reason}`,
    });
    await audit(tx, ctx, "ledger.reversal", "LedgerEntry", entry.id, { reversalOf: orig.id, reason });
    return { entry };
  });
}
