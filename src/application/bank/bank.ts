import { and, desc, eq } from "drizzle-orm";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { bankStatements, bankTransactions, invoices, receipts } from "@/infrastructure/db/schema";
import { rule } from "@/domain/errors";
import { deltasFor } from "@/domain/ledger";
import { dateInputToDate, todayKey } from "@/domain/period";
import { matchBankLine, parseBankFile } from "@/domain/reconcile";
import { toReceiptDataUrl } from "../receipts/inline-file";
import { requireRole, tid, type Ctx } from "../context";
import { accountBalance, audit, insertEntry, insufficient } from "../ledger-service";

export async function listBankStatements(ctx: Ctx) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, (tx) =>
    tx.select().from(bankStatements).where(eq(bankStatements.tenantId, tenantId)).orderBy(desc(bankStatements.createdAt)).limit(50),
  );
}

export async function getBankStatement(ctx: Ctx, id: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const st = await tx.query.bankStatements.findFirst({
      where: and(eq(bankStatements.id, id), eq(bankStatements.tenantId, tenantId)),
    });
    if (!st) return null;
    const lines = await tx.select().from(bankTransactions)
      .where(eq(bankTransactions.statementId, id))
      .orderBy(desc(bankTransactions.bookingDate));
    return { statement: st, lines };
  });
}

export async function uploadBankStatement(
  ctx: Ctx, periodMonth: string, file: { data: Buffer; mime: string; name: string },
) {
  requireRole(ctx, "ADMIN");
  if (!/^\d{4}-\d{2}$/.test(periodMonth)) throw rule("Monat im Format JJJJ-MM");
  const tenantId = tid(ctx);
  const parsed = parseBankFile(file.name, file.mime, file.data);
  if (!parsed.length) throw rule("Keine Buchungen erkannt. Bitte CSV (mit Betrag/Datum) oder OFX hochladen.");

  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const invs = await tx.select({
      id: invoices.id, amountCents: invoices.grossCents, paidAt: invoices.paidAt, issueDate: invoices.issueDate,
    }).from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, "PAID")));
    const recs = await tx.select({
      id: receipts.id, amountCents: receipts.amountCents, receiptDate: receipts.receiptDate,
    }).from(receipts).where(eq(receipts.tenantId, tenantId));
    const invC = invs.map((i) => ({
      id: i.id, amountCents: i.amountCents, dateKey: todayKey(i.paidAt ?? i.issueDate ?? new Date()),
    }));
    const recC = recs.map((r) => ({ id: r.id, amountCents: r.amountCents, dateKey: todayKey(r.receiptDate) }));

    const fileKey = toReceiptDataUrl(file.mime || "text/plain", file.data);
    const [st] = await tx.insert(bankStatements).values({
      tenantId, periodMonth, fileName: file.name, fileMime: file.mime || "text/plain",
      fileKey, createdById: ctx.userId,
    }).returning();

    for (const line of parsed) {
      const m = matchBankLine(line, invC, recC);
      let postedLedgerId: string | null = null;
      if (m.status === "CASH_WITHDRAWAL") {
        const amt = Math.abs(line.amountCents);
        const bank = await accountBalance(tx, tenantId, "BANK");
        if (bank < amt) throw insufficient("Bankkonto für Geldtransit", bank);
        const entry = await insertEntry(tx, ctx, tenantId, {
          type: "CASH_WITHDRAWAL", ...deltasFor("CASH_WITHDRAWAL", amt),
          bookingDate: dateInputToDate(line.bookingDate),
          description: `Geldautomat / Bargeldabhebung: ${line.payee || line.purpose || "Bank"}`.slice(0, 300),
        });
        postedLedgerId = entry.id;
      }
      await tx.insert(bankTransactions).values({
        tenantId, statementId: st.id,
        bookingDate: dateInputToDate(line.bookingDate),
        amountCents: line.amountCents,
        payee: line.payee || null, purpose: line.purpose || null, iban: line.iban || null,
        status: m.status, matchedInvoiceId: m.invoiceId ?? null, matchedReceiptId: m.receiptId ?? null,
        postedLedgerId,
      });
    }
    await audit(tx, ctx, "bank.statement", "BankStatement", st.id, { lines: parsed.length, periodMonth });
    return { id: st.id, lines: parsed.length };
  });
}
