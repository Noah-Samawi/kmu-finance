import { eq } from "drizzle-orm";
import { z } from "zod";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { users } from "@/infrastructure/db/schema";
import { forbidden, rule } from "@/domain/errors";
import { ACCOUNT_LABEL } from "@/domain/accounts";
import { deltasFor } from "@/domain/ledger";
import { dateInputToDate, todayKey } from "@/domain/period";
import { outlayRepaySchema, outlaySchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import {
  accountBalance, audit, claimBalance, insertEntry, insufficient, loadEmployee, poolBalance,
} from "../ledger-service";

export async function recordEmployeeOutlay(ctx: Ctx, input: z.infer<typeof outlaySchema>) {
  requireRole(ctx, "EMPLOYEE");
  const tenantId = tid(ctx);
  if (input.bookingDate && input.bookingDate > todayKey()) throw rule("Buchungsdatum darf nicht in der Zukunft liegen");
  return withTenant(ctx, async (tx) => {
    const me = await tx.query.users.findFirst({ where: eq(users.id, ctx.userId) });
    if (!me?.canEnterOutlay) throw forbidden("Auslagen sind für dich nicht freigeschaltet");
    await lockTenantLedger(tx, tenantId);
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "EMPLOYEE_OUTLAY", ...deltasFor("EMPLOYEE_OUTLAY", input.amountCents),
      employeeId: ctx.userId, description: input.description,
      bookingDate: input.bookingDate ? dateInputToDate(input.bookingDate) : new Date(),
    });
    await audit(tx, ctx, "outlay.recorded", "LedgerEntry", entry.id, { amountCents: input.amountCents });
    return { entry, claimBalanceCents: await claimBalance(tx, tenantId, ctx.userId) };
  });
}

/** Admin bucht eine Auslage / Gutschrift für den Mitarbeiter (Firma schuldet ihm den Betrag) */
export async function adminRecordOutlay(ctx: Ctx, employeeId: string, input: z.infer<typeof outlaySchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  if (input.bookingDate && input.bookingDate > todayKey()) throw rule("Buchungsdatum darf nicht in der Zukunft liegen");
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const emp = await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "EMPLOYEE_OUTLAY", ...deltasFor("EMPLOYEE_OUTLAY", input.amountCents),
      employeeId: emp.id, description: `${input.description} · erfasst durch Geschäftsführung`,
      bookingDate: input.bookingDate && input.bookingDate !== todayKey() ? dateInputToDate(input.bookingDate) : new Date(),
    });
    await audit(tx, ctx, "outlay.recorded-by-admin", "LedgerEntry", entry.id, { employeeId: emp.id, amountCents: input.amountCents });
    return { entry, claimBalanceCents: await claimBalance(tx, tenantId, emp.id) };
  });
}

export async function repayOutlay(ctx: Ctx, employeeId: string, input: z.infer<typeof outlayRepaySchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const account = input.accountKind ?? "CASH";
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const claim = await claimBalance(tx, tenantId, employeeId);
    const amount = input.all ? claim : input.amountCents!;
    if (amount <= 0) throw rule("Kein offener Auslagen-Anspruch");
    if (amount > claim) throw insufficient("Offener Anspruch des Mitarbeiters", claim);
    const avail = await accountBalance(tx, tenantId, account);
    if (avail < amount) throw insufficient(ACCOUNT_LABEL[account], avail);
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "OUTLAY_REPAY", ...deltasFor("OUTLAY_REPAY", amount, account),
      employeeId, description: `${input.description} · aus ${ACCOUNT_LABEL[account]}`,
    });
    await audit(tx, ctx, "outlay.repaid", "LedgerEntry", entry.id, { employeeId, amountCents: amount, accountKind: account });
    return {
      entry,
      claimBalanceCents: claim - amount,
      poolBalanceCents: await poolBalance(tx, tenantId),
    };
  });
}
