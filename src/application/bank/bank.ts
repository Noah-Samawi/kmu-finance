import { aliasedTable, and, desc, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { bankStatements, bankTransactions, invoices, ledgerEntries, receipts } from "@/infrastructure/db/schema";
import { rule } from "@/domain/errors";
import { deltasFor } from "@/domain/ledger";
import { dateInputToDate, todayKey } from "@/domain/period";
import { expenseDeltas } from "@/domain/cash";
import { autoPosting, matchBankLine, parseBankFile } from "@/domain/reconcile";
import { toReceiptDataUrl } from "../receipts/inline-file";
import { requireRole, tid, type Ctx } from "../context";
import { accountBalance, audit, insertEntry } from "../ledger-service";
import { assertBranch } from "../branches/assert-branch";
import { notHidden } from "../reports/reports";

const bankReversal = aliasedTable(ledgerEntries, "bank_reversal");

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

export interface BankUploadOptions {
  /** rote Zeilen automatisch verbuchen (Einnahme bzw. Ausgabe Bankkonto) */
  autoBook?: boolean;
  branchId?: string | null;
}

/**
 * Kontoauszug (CSV, OFX oder PDF-Textlayer) einlesen und mit dem Hauptbuch abgleichen:
 * Grün = schon gebucht (Bankbuchung, Rechnung, Beleg) · Blau = Geldtransit Bank → Kasse ·
 * Verbucht = neu als Einnahme/Ausgabe Bankkonto gebucht · Rot = offen.
 */
export async function uploadBankStatement(
  ctx: Ctx, periodMonth: string, file: { data: Buffer; mime: string; name: string }, opts: BankUploadOptions = {},
) {
  requireRole(ctx, "ADMIN");
  if (!/^\d{4}-\d{2}$/.test(periodMonth)) throw rule("Monat im Format JJJJ-MM");
  const tenantId = tid(ctx);
  const parsed = parseBankFile(file.name, file.mime, file.data, periodMonth);
  if (!parsed.length) throw rule("Keine Buchungen erkannt. Bitte CSV (mit Betrag/Datum), OFX oder PDF-Kontoauszug hochladen.");

  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const branchId = await assertBranch(tx, tenantId, opts.branchId);
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

    const days = parsed.map((l) => l.bookingDate).sort();
    const from = new Date(dateInputToDate(days[0]).getTime() - 6 * 86400000);
    const to = new Date(dateInputToDate(days[days.length - 1]).getTime() + 6 * 86400000);
    const bankRows: { id: string; amountCents: number; bookingDate: Date }[] = await tx.select({ id: ledgerEntries.id, amountCents: ledgerEntries.bankDeltaCents, bookingDate: ledgerEntries.bookingDate })
      .from(ledgerEntries)
      .leftJoin(bankReversal, eq(bankReversal.reversalOfId, ledgerEntries.id))
      .where(and(
        eq(ledgerEntries.tenantId, tenantId), ne(ledgerEntries.bankDeltaCents, 0), ne(ledgerEntries.type, "REVERSAL"),
        isNull(bankReversal.id), notHidden(), gte(ledgerEntries.bookingDate, from), lt(ledgerEntries.bookingDate, to),
      ));
    const ledgerC = bankRows.map((l) => ({ id: l.id, amountCents: l.amountCents, dateKey: todayKey(l.bookingDate) }));
    const used = new Set<string>();

    const fileKey = toReceiptDataUrl(file.mime || "text/plain", file.data);
    const [st] = await tx.insert(bankStatements).values({
      tenantId, periodMonth, fileName: file.name, fileMime: file.mime || "text/plain",
      fileKey, branchId, createdById: ctx.userId,
    }).returning();

    const counts = { GREEN: 0, BOOKED: 0, CASH_WITHDRAWAL: 0, RED: 0 };
    let bank = await accountBalance(tx, tenantId, "BANK");
    for (const line of parsed) {
      const m = matchBankLine(line, invC, recC, ledgerC, used);
      if (m.ledgerId) used.add(m.ledgerId);
      let status: "GREEN" | "RED" | "CASH_WITHDRAWAL" | "BOOKED" = m.status;
      let postedLedgerId: string | null = null;
      const amt = Math.abs(line.amountCents);
      const bookingDate = dateInputToDate(line.bookingDate);
      if (m.status === "CASH_WITHDRAWAL") {
        if (bank < amt) status = "RED";
        else {
          const entry = await insertEntry(tx, ctx, tenantId, {
            type: "CASH_WITHDRAWAL", ...deltasFor("CASH_WITHDRAWAL", amt), bookingDate, branchId,
            description: `Geldautomat / Bargeldabhebung: ${line.payee || line.purpose || "Bank"}`.slice(0, 300),
          });
          postedLedgerId = entry.id;
          bank -= amt;
        }
      } else if (m.status === "RED" && opts.autoBook && (line.amountCents > 0 || bank >= amt)) {
        const p = autoPosting(line);
        const entry = await insertEntry(tx, ctx, tenantId, {
          type: p.type,
          ...(p.type === "EXPENSE" ? expenseDeltas("BANK", amt) : deltasFor("INCOME_MANUAL", amt, "BANK")),
          category: p.category, bookingDate, branchId, description: p.description.slice(0, 300),
        });
        postedLedgerId = entry.id;
        status = "BOOKED";
        bank += line.amountCents;
      }
      counts[status]++;
      await tx.insert(bankTransactions).values({
        tenantId, statementId: st.id, bookingDate,
        amountCents: line.amountCents,
        payee: line.payee || null, purpose: line.purpose || null, iban: line.iban || null,
        status, matchedInvoiceId: m.invoiceId ?? null, matchedReceiptId: m.receiptId ?? null,
        matchedLedgerId: m.ledgerId ?? null, postedLedgerId,
      });
    }
    const incomeCents = parsed.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
    const expenseCents = parsed.filter((l) => l.amountCents < 0).reduce((s, l) => s - l.amountCents, 0);
    await audit(tx, ctx, "bank.statement", "BankStatement", st.id, {
      lines: parsed.length, periodMonth, autoBook: !!opts.autoBook, branchId, counts, incomeCents, expenseCents,
    });
    return { id: st.id, lines: parsed.length, counts, incomeCents, expenseCents, bankBalanceCents: bank };
  });
}
