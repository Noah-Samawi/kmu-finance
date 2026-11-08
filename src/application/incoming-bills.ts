// Eingangsrechnungen / Lieferantenbelege: Upload mit Pflicht-Zahlungskanal,
// OCR-Daten kommen vom Client, Buchung nur nach Bestätigung, Status immer sichtbar.
import { createHash } from "node:crypto";
import { aliasedTable, and, desc, eq, gte, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/infrastructure/db/client";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { branches, incomingBills, ledgerAttachments, ledgerCorrections, ledgerEntries } from "@/infrastructure/db/schema";
import { conflict, isAppError, notFound, rule } from "@/domain/errors";
import { ACCOUNT_LABEL } from "@/domain/accounts";
import { categoryLabel, expenseDeltas, FUND_LABEL } from "@/domain/cash";
import {
  billDuplicateWarning, fundFromPayKind, presentBill, resolvePaidCents,
  type BillPayKind, type BillStatus,
} from "@/domain/incoming-bill";
import { dateInputToDate, dayRange, todayKey } from "@/domain/period";
import {
  cancelIncomingBillSchema, incomingBillSchema, payIncomingBillSchema,
} from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "./context";
import { accountBalance, audit, bankBalance, cashBalance, insertEntry, insufficient } from "./ledger-service";
import { assertBranch } from "./branches/assert-branch";
import { parseReceiptDataUrl } from "./receipts/inline-file";
import { storeReceiptFile, type UploadFile } from "./receipts/store-file";
import { storage } from "@/infrastructure/storage";

function assertNotFuture(day?: string) {
  if (day && day > todayKey()) throw rule("Buchungsdatum darf nicht in der Zukunft liegen");
}

const bookingDateFor = (day?: string) => (day && day !== todayKey() ? dateInputToDate(day) : new Date());

const reversal = aliasedTable(ledgerEntries, "bill_reversal");

async function countSameOnFund(
  tx: Tx, tenantId: string, supplier: string, amountCents: number, fund: "CASH" | "BANK", day: string, exceptId?: string,
) {
  const { start, end } = dayRange(day);
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(incomingBills).where(and(
    eq(incomingBills.tenantId, tenantId),
    eq(incomingBills.amountCents, amountCents),
    eq(incomingBills.fund, fund),
    isNull(incomingBills.canceledAt),
    gte(incomingBills.bookingDate, start),
    lt(incomingBills.bookingDate, end),
    sql`lower(${incomingBills.supplier}) = lower(${supplier})`,
    exceptId ? sql`${incomingBills.id} <> ${exceptId}` : undefined,
  ));
  return Number(r?.n ?? 0);
}

async function bookExpense(
  tx: Tx, ctx: Ctx, tenantId: string,
  input: { fund: "CASH" | "BANK"; amountCents: number; category: string; purpose: string; bookingDate: Date; branchId: string | null },
  stored: { key: string; mime: string; name: string } | null,
) {
  const avail = await accountBalance(tx, tenantId, input.fund);
  if (avail < input.amountCents) throw insufficient(ACCOUNT_LABEL[input.fund], avail);
  const deltas = expenseDeltas(input.fund, input.amountCents);
  const entry = await insertEntry(tx, ctx, tenantId, {
    type: "EXPENSE", ...deltas, category: input.category, branchId: input.branchId, bookingDate: input.bookingDate,
    description: [
      "Eingangsrechnung", input.purpose, categoryLabel(input.category), `aus ${FUND_LABEL[input.fund]}`,
    ].filter(Boolean).join(" · "),
  });
  if (stored) {
    await tx.insert(ledgerAttachments).values({
      tenantId, ledgerEntryId: entry.id, fileKey: stored.key, mime: stored.mime, name: stored.name, createdById: ctx.userId,
    });
  }
  return entry;
}

function viewOf(
  row: {
    id: string; supplier: string; amountCents: number; paidCents: number; payKind: string;
    fund: "CASH" | "BANK" | null; category: string | null; purpose: string | null; bookingDate: Date;
    branchId: string | null; branchName: string | null; ledgerEntryId: string | null;
    fileName: string | null; fileMime: string | null; canceledAt: Date | null;
    reversed?: boolean; removed?: boolean;
  },
  extra?: { warnings?: string[] },
) {
  const presented = presentBill(row.amountCents, row.paidCents, row.fund, {
    reversed: row.reversed, removed: row.removed,
  });
  return {
    id: row.id,
    supplier: row.supplier,
    amountCents: row.amountCents,
    paidCents: row.paidCents,
    payKind: row.payKind as BillPayKind,
    fund: row.fund,
    category: row.category,
    categoryLabel: categoryLabel(row.category),
    purpose: row.purpose,
    bookingDate: row.bookingDate.toISOString(),
    branchId: row.branchId,
    branchName: row.branchName,
    ledgerEntryId: row.removed ? null : row.ledgerEntryId,
    fileName: row.fileName,
    hasFile: !!row.fileName || !!row.fileMime,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    ...presented,
    warnings: extra?.warnings ?? [],
  };
}

export async function recordIncomingBill(ctx: Ctx, input: z.infer<typeof incomingBillSchema>, file?: UploadFile | null) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  if (!file) throw rule("Bitte die Rechnung oder Quittung als Datei hochladen");
  assertNotFuture(input.bookingDate);
  const payKind = input.payKind as BillPayKind;
  const paidCents = resolvePaidCents(payKind, input.amountCents, input.paidCents);
  const fund = fundFromPayKind(payKind);
  const purpose = (input.purpose?.trim() || input.supplier).slice(0, 500);
  const day = input.bookingDate ?? todayKey();
  const sha = createHash("sha256").update(file.data).digest("hex");
  const stored = await storeReceiptFile(tenantId, "incoming-bills", file);

  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const dup = await tx.select({ id: incomingBills.id }).from(incomingBills).where(and(
      eq(incomingBills.tenantId, tenantId), eq(incomingBills.fileSha256, sha), isNull(incomingBills.canceledAt),
    )).limit(1);
    if (dup[0]) throw conflict("Diese Datei wurde bereits als Eingangsrechnung erfasst");

    const branchId = await assertBranch(tx, tenantId, input.branchId);
    const bookingDate = bookingDateFor(input.bookingDate);
    const warnings: string[] = [];
    if (fund) {
      const n = await countSameOnFund(tx, tenantId, input.supplier, input.amountCents, fund, day);
      const w = billDuplicateWarning(fund, bookingDate, n, input.supplier);
      if (w) warnings.push(w);
    }

    let ledgerEntryId: string | null = null;
    if (fund && paidCents > 0) {
      const entry = await bookExpense(tx, ctx, tenantId, {
        fund, amountCents: paidCents, category: input.category, purpose, bookingDate, branchId,
      }, stored);
      ledgerEntryId = entry.id;
    }

    const [row] = await tx.insert(incomingBills).values({
      tenantId, supplier: input.supplier, amountCents: input.amountCents, paidCents, payKind, fund,
      category: input.category, purpose, bookingDate, branchId,
      fileKey: stored.key, fileMime: stored.mime, fileName: stored.name, fileSha256: sha,
      ledgerEntryId, createdById: ctx.userId,
    }).returning();

    await audit(tx, ctx, "bill.create", "IncomingBill", row.id, {
      payKind, fund, amountCents: input.amountCents, paidCents, supplier: input.supplier, ledgerEntryId, branchId,
    });

    const branchName = branchId
      ? (await tx.select({ name: branches.name }).from(branches).where(eq(branches.id, branchId)).limit(1))[0]?.name ?? null
      : null;
    const presented = viewOf({ ...row, branchName, reversed: false, removed: false }, { warnings });
    return {
      bill: presented,
      cashBalanceCents: await cashBalance(tx, tenantId),
      bankBalanceCents: await bankBalance(tx, tenantId),
    };
  });
}

export async function listIncomingBills(ctx: Ctx, opts: { q?: string; status?: BillStatus; limit?: number } = {}) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const q = opts.q?.replace(/[%_\\]/g, "").trim().slice(0, 100) || undefined;
  const rows = await withTenant(ctx, (tx) => tx.select({
    bill: incomingBills,
    branchName: branches.name,
    reversalId: reversal.id,
    correctionKind: ledgerCorrections.kind,
  }).from(incomingBills)
    .leftJoin(branches, eq(branches.id, incomingBills.branchId))
    .leftJoin(reversal, eq(reversal.reversalOfId, incomingBills.ledgerEntryId))
    .leftJoin(ledgerCorrections, eq(ledgerCorrections.originalId, incomingBills.ledgerEntryId))
    .where(and(
      eq(incomingBills.tenantId, tenantId),
      isNull(incomingBills.canceledAt),
      q ? or(
        ilike(incomingBills.supplier, `%${q}%`),
        ilike(incomingBills.purpose, `%${q}%`),
        ilike(incomingBills.category, `%${q}%`),
      ) : undefined,
    ))
    .orderBy(desc(incomingBills.bookingDate), desc(incomingBills.createdAt))
    .limit(opts.limit ?? 200));

  const list = rows.map((r) => viewOf({
    ...r.bill,
    branchName: r.branchName,
    reversed: !!r.reversalId && r.correctionKind !== "REMOVE",
    removed: r.correctionKind === "REMOVE",
  }));
  return opts.status ? list.filter((b) => b.status === opts.status) : list;
}

export async function payIncomingBill(ctx: Ctx, id: string, input: z.infer<typeof payIncomingBillSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  assertNotFuture(input.bookingDate);

  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const [row] = await tx.select().from(incomingBills).where(and(
      eq(incomingBills.id, id), eq(incomingBills.tenantId, tenantId), isNull(incomingBills.canceledAt),
    )).limit(1);
    if (!row) throw notFound("Eingangsrechnung");
    const remaining = row.amountCents - row.paidCents;
    if (remaining <= 0) throw rule("Diese Rechnung ist bereits vollständig bezahlt oder hat ein Guthaben");

    const add = input.paidCents == null ? remaining : input.paidCents;
    if (add <= 0) throw rule("Bitte den gezahlten Betrag eingeben");
    const fund = input.payKind;
    const day = input.bookingDate ?? todayKey();
    const bookingDate = bookingDateFor(input.bookingDate);
    const branchId = input.branchId !== undefined ? await assertBranch(tx, tenantId, input.branchId) : row.branchId;
    const purpose = (row.purpose || row.supplier).slice(0, 500);
    const stored = row.fileKey && row.fileMime && row.fileName
      ? { key: row.fileKey, mime: row.fileMime, name: row.fileName } : null;

    const warnings: string[] = [];
    const n = await countSameOnFund(tx, tenantId, row.supplier, row.amountCents, fund, day, row.id);
    const w = billDuplicateWarning(fund, bookingDate, n, row.supplier);
    if (w) warnings.push(w);

    const entry = await bookExpense(tx, ctx, tenantId, {
      fund, amountCents: add, category: row.category || "SONSTIGES", purpose, bookingDate, branchId,
    }, stored);

    const paidCents = row.paidCents + add;
    const [updated] = await tx.update(incomingBills).set({
      paidCents, payKind: fund, fund, ledgerEntryId: row.ledgerEntryId ?? entry.id, branchId, updatedAt: new Date(),
    }).where(eq(incomingBills.id, row.id)).returning();

    await audit(tx, ctx, "bill.pay", "IncomingBill", row.id, {
      payKind: fund, addCents: add, paidCents, ledgerEntryId: entry.id,
    });

    return {
      bill: viewOf({ ...updated, branchName: null }),
      warnings,
      cashBalanceCents: await cashBalance(tx, tenantId),
      bankBalanceCents: await bankBalance(tx, tenantId),
    };
  });
}

export async function cancelIncomingBill(ctx: Ctx, id: string, input: z.infer<typeof cancelIncomingBillSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(incomingBills).where(and(
      eq(incomingBills.id, id), eq(incomingBills.tenantId, tenantId), isNull(incomingBills.canceledAt),
    )).limit(1);
    if (!row) throw notFound("Eingangsrechnung");
    if (row.ledgerEntryId && row.paidCents > 0) {
      throw rule("Bezahlt gebuchte Rechnungen bitte über Löschen oder Stornieren der Buchung korrigieren");
    }
    await tx.update(incomingBills).set({
      canceledAt: new Date(), cancelReason: input.reason, updatedAt: new Date(),
    }).where(eq(incomingBills.id, row.id));
    await audit(tx, ctx, "bill.cancel", "IncomingBill", row.id, { reason: input.reason });
    return { ok: true };
  });
}

export async function getIncomingBillFile(ctx: Ctx, id: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const row = await withTenant(ctx, (tx) => tx.select({
    fileKey: incomingBills.fileKey, fileMime: incomingBills.fileMime, fileName: incomingBills.fileName,
  }).from(incomingBills).where(and(eq(incomingBills.id, id), eq(incomingBills.tenantId, tenantId))).limit(1));
  const f = row[0];
  if (!f?.fileKey) throw notFound("Belegdatei");
  const inline = parseReceiptDataUrl(f.fileKey);
  if (inline) return { data: inline.data, mime: inline.mime, name: f.fileName || "beleg" };
  try {
    return { data: await storage.get(f.fileKey), mime: f.fileMime || "application/octet-stream", name: f.fileName || "beleg" };
  } catch (e) {
    if (isAppError(e)) throw e;
    throw notFound("Belegdatei");
  }
}
