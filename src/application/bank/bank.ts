import { aliasedTable, and, desc, eq, gte, isNull, lt, ne } from "drizzle-orm";
import { createHash } from "node:crypto";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { bankStatements, bankTransactions, invoices, ledgerEntries, receipts } from "@/infrastructure/db/schema";
import { conflict, rule } from "@/domain/errors";
import { deltasFor } from "@/domain/ledger";
import { dateInputToDate, todayKey } from "@/domain/period";
import { expenseDeltas } from "@/domain/cash";
import { formatCents } from "@/domain/money";
import { autoPosting, matchBankLine, parseBankFile, type ParsedBankLine } from "@/domain/reconcile";
import { toReceiptDataUrl } from "../receipts/inline-file";
import { requireRole, tid, type Ctx } from "../context";
import { accountBalance, audit, insertEntry } from "../ledger-service";
import { assertBranch } from "../branches/assert-branch";
import { notHidden } from "../reports/reports";
import { fileSha256, scanBankStatementAi, scanConfigured } from "./scan-statement";

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

export interface PreviewLine extends ParsedBankLine {
  status: "GREEN" | "RED" | "CASH_WITHDRAWAL";
  matchHint: string | null;
}

export interface BankPreview {
  lines: PreviewLine[];
  openingCents: number | null;
  closingCents: number | null;
  /** Summe der erkannten Umsätze */
  movementCents: number;
  /** Errechneter Endsaldo = Anfang + Umsätze (nur wenn Anfang bekannt) */
  computedClosingCents: number | null;
  /** true, wenn ausgewiesener Endsaldo und errechneter Endsaldo übereinstimmen */
  balanceOk: boolean | null;
  incomeCents: number;
  expenseCents: number;
  duplicateFile: boolean;
  duplicateMonth: boolean;
  source: "gemini" | "text" | "csv" | "ofx";
  fileSha256: string;
  fileName: string;
  fileMime: string;
  /** Base64 der Originaldatei – für Bestätigung erneut mitschicken */
  fileB64: string;
}

async function parseUpload(
  file: { data: Buffer; mime: string; name: string }, periodMonth: string, forceAi?: boolean,
): Promise<{ lines: ParsedBankLine[]; openingCents: number | null; closingCents: number | null; source: BankPreview["source"] }> {
  const name = file.name.toLowerCase();
  const isPdf = file.mime === "application/pdf" || name.endsWith(".pdf");
  const isPdfText = file.mime === "text/x-pdf-text" || name.endsWith(".pdf.txt");

  if (!forceAi && !isPdf) {
    const lines = parseBankFile(file.name, file.mime, file.data, periodMonth);
    if (lines.length) {
      const source: BankPreview["source"] =
        name.endsWith(".ofx") || name.endsWith(".qfx") || file.mime.includes("ofx") ? "ofx"
          : isPdfText ? "text" : "csv";
      return { lines, openingCents: null, closingCents: null, source };
    }
  }

  if (isPdfText) {
    const lines = parseBankFile(file.name, file.mime, file.data, periodMonth);
    if (lines.length) return { lines, openingCents: null, closingCents: null, source: "text" };
  }

  // Scan / Foto / PDF ohne brauchbaren Text → Gemini
  if (isPdf || file.mime.startsWith("image/") || forceAi) {
    if (!scanConfigured()) {
      throw rule("PDF ohne lesbaren Text. Bitte CSV/OFX der Bank hochladen oder GEMINI_API_KEY für Scans einrichten.");
    }
    const mime = isPdf || file.mime === "application/pdf" ? "application/pdf"
      : file.mime.startsWith("image/") ? file.mime : "application/pdf";
    const scanned = await scanBankStatementAi({ data: file.data, mime });
    return { lines: scanned.lines, openingCents: scanned.openingCents, closingCents: scanned.closingCents, source: "gemini" };
  }

  throw rule("Keine Buchungen erkannt. Bitte CSV (mit Betrag/Datum), OFX oder PDF-Kontoauszug hochladen.");
}

/**
 * Kontoauszug nur lesen und Ampel/Saldo prüfen – noch nichts buchen.
 * Duplikat: gleiche Datei (SHA) oder schon ein Auszug für denselben Monat.
 */
export async function previewBankStatement(
  ctx: Ctx, periodMonth: string, file: { data: Buffer; mime: string; name: string }, opts: { forceAi?: boolean } = {},
): Promise<BankPreview> {
  requireRole(ctx, "ADMIN");
  if (!/^\d{4}-\d{2}$/.test(periodMonth)) throw rule("Monat im Format JJJJ-MM");
  const tenantId = tid(ctx);
  const sha = fileSha256(file.data);
  const parsed = await parseUpload(file, periodMonth, opts.forceAi);

  return withTenant(ctx, async (tx) => {
    const dupFile = !!(await tx.query.bankStatements.findFirst({
      where: and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.fileSha256, sha)),
      columns: { id: true },
    }));
    const dupMonth = !!(await tx.query.bankStatements.findFirst({
      where: and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.periodMonth, periodMonth)),
      columns: { id: true },
    }));

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

    const days = parsed.lines.map((l) => l.bookingDate).sort();
    const from = days.length ? new Date(dateInputToDate(days[0]).getTime() - 6 * 86400000) : new Date(0);
    const to = days.length ? new Date(dateInputToDate(days[days.length - 1]).getTime() + 6 * 86400000) : new Date(0);
    const bankRows = days.length
      ? await tx.select({ id: ledgerEntries.id, amountCents: ledgerEntries.bankDeltaCents, bookingDate: ledgerEntries.bookingDate })
        .from(ledgerEntries)
        .leftJoin(bankReversal, eq(bankReversal.reversalOfId, ledgerEntries.id))
        .where(and(
          eq(ledgerEntries.tenantId, tenantId), ne(ledgerEntries.bankDeltaCents, 0), ne(ledgerEntries.type, "REVERSAL"),
          isNull(bankReversal.id), notHidden(), gte(ledgerEntries.bookingDate, from), lt(ledgerEntries.bookingDate, to),
        ))
      : [] as { id: string; amountCents: number; bookingDate: Date }[];
    const ledgerC = bankRows.map((l) => ({ id: l.id, amountCents: l.amountCents, dateKey: todayKey(l.bookingDate) }));
    const used = new Set<string>();

    const lines: PreviewLine[] = parsed.lines.map((line) => {
      const m = matchBankLine(line, invC, recC, ledgerC, used);
      if (m.ledgerId) used.add(m.ledgerId);
      const matchHint = m.ledgerId ? "schon im Hauptbuch" : m.invoiceId ? "passt zu Rechnung" : m.receiptId ? "passt zu Beleg" : m.status === "CASH_WITHDRAWAL" ? "Geldautomat" : null;
      return { ...line, status: m.status, matchHint };
    });

    const movementCents = lines.reduce((s, l) => s + l.amountCents, 0);
    const computedClosingCents = parsed.openingCents != null ? parsed.openingCents + movementCents : null;
    const balanceOk = parsed.closingCents != null && computedClosingCents != null
      ? parsed.closingCents === computedClosingCents
      : null;

    return {
      lines,
      openingCents: parsed.openingCents,
      closingCents: parsed.closingCents,
      movementCents,
      computedClosingCents,
      balanceOk,
      incomeCents: lines.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0),
      expenseCents: lines.filter((l) => l.amountCents < 0).reduce((s, l) => s - l.amountCents, 0),
      duplicateFile: dupFile,
      duplicateMonth: dupMonth,
      source: parsed.source,
      fileSha256: sha,
      fileName: file.name,
      fileMime: file.mime || "application/octet-stream",
      fileB64: file.data.toString("base64"),
    };
  });
}

export interface BankUploadOptions {
  autoBook?: boolean;
  branchId?: string | null;
  /** Original-SHA aus der Vorschau – bei Abweichung abbrechen */
  expectedSha?: string | null;
  openingCents?: number | null;
  closingCents?: number | null;
  /** bewusste Doppelbuchung trotz gleichem Monat/Datei */
  force?: boolean;
}

/**
 * Kontoauszug (CSV, OFX, PDF-Text oder Scan) einlesen und mit dem Hauptbuch abgleichen.
 * Vorher sollte previewBankStatement die Vorschau gezeigt haben.
 */
export async function uploadBankStatement(
  ctx: Ctx, periodMonth: string, file: { data: Buffer; mime: string; name: string }, opts: BankUploadOptions = {},
) {
  requireRole(ctx, "ADMIN");
  if (!/^\d{4}-\d{2}$/.test(periodMonth)) throw rule("Monat im Format JJJJ-MM");
  const tenantId = tid(ctx);
  const sha = fileSha256(file.data);
  if (opts.expectedSha && opts.expectedSha !== sha) throw rule("Datei hat sich geändert – bitte erneut einlesen");
  const parsed = await parseUpload(file, periodMonth);

  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    if (!opts.force) {
      const same = await tx.query.bankStatements.findFirst({
        where: and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.fileSha256, sha)),
        columns: { id: true, fileName: true },
      });
      if (same) throw conflict(`Dieser Auszug wurde bereits eingelesen (${same.fileName}).`);
    }
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

    const days = parsed.lines.map((l) => l.bookingDate).sort();
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
    const { resolveCompanyId } = await import("../companies/resolve-company");
    const companyId = await resolveCompanyId(tx, tenantId, branchId);
    const [st] = await tx.insert(bankStatements).values({
      tenantId, companyId, periodMonth, fileName: file.name, fileMime: file.mime || "text/plain",
      fileKey, fileSha256: sha,
      openingCents: opts.openingCents ?? parsed.openingCents,
      closingCents: opts.closingCents ?? parsed.closingCents,
      branchId, createdById: ctx.userId,
    }).returning();

    const counts = { GREEN: 0, BOOKED: 0, CASH_WITHDRAWAL: 0, RED: 0 };
    let bank = await accountBalance(tx, tenantId, "BANK");
    for (const line of parsed.lines) {
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
        tenantId, companyId, statementId: st.id, bookingDate,
        amountCents: line.amountCents,
        payee: line.payee || null, purpose: line.purpose || null, iban: line.iban || null,
        status, matchedInvoiceId: m.invoiceId ?? null, matchedReceiptId: m.receiptId ?? null,
        matchedLedgerId: m.ledgerId ?? null, postedLedgerId,
      });
    }
    const incomeCents = parsed.lines.filter((l) => l.amountCents > 0).reduce((s, l) => s + l.amountCents, 0);
    const expenseCents = parsed.lines.filter((l) => l.amountCents < 0).reduce((s, l) => s - l.amountCents, 0);
    await audit(tx, ctx, "bank.statement", "BankStatement", st.id, {
      lines: parsed.lines.length, periodMonth, autoBook: !!opts.autoBook, branchId, counts, incomeCents, expenseCents, sha,
    });
    return {
      id: st.id, lines: parsed.lines.length, counts, incomeCents, expenseCents, bankBalanceCents: bank,
      openingLabel: opts.openingCents != null ? formatCents(opts.openingCents) : null,
      closingLabel: opts.closingCents != null ? formatCents(opts.closingCents) : null,
    };
  });
}

export { createHash };
