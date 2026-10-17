// Kasse & Bank (Gastro): kombinierte Tageseinnahme, Dubletten-Hinweis, Betriebsausgaben mit Kategorie und Beleg,
// Bestandskorrektur zum Stichtag. Alles append-only – Korrektur nur per Storno bzw. Differenzbuchung.
import { randomUUID } from "node:crypto";
import { aliasedTable, and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/infrastructure/db/client";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { ledgerAttachments, ledgerEntries, users } from "@/infrastructure/db/schema";
import { storage } from "@/infrastructure/storage";
import { forbidden, isAppError, notFound, rule } from "@/domain/errors";
import { ACCOUNT_LABEL } from "@/domain/accounts";
import { deltasFor } from "@/domain/ledger";
import { assertPurpose } from "@/domain/partner";
import {
  FUND_LABEL, categoryLabel, correctionDiff, correctionText, dailyIncomeParts, duplicateWarning, duplicateWarnings, expenseDeltas,
} from "@/domain/cash";
import { dateInputToDate, dayRange, todayKey } from "@/domain/period";
import { balanceCorrectionSchema, dailyIncomeSchema, expenseSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import { accountBalance, audit, bankBalance, cashBalance, insertEntry, insufficient, walletBalance } from "../ledger-service";
import { parseReceiptDataUrl } from "../receipts/inline-file";
import { storeReceiptFile, type UploadFile } from "../receipts/store-file";

export interface Person { id: string; name: string; role: "EMPLOYEE" | "PARTNER"; isActive: boolean }

/** Auswahl "Person zuordnen": Mitarbeiter, Partner und Gesellschafter */
export async function listPersons(ctx: Ctx): Promise<Person[]> {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const rows = await withTenant(ctx, (tx) => tx.select({ id: users.id, name: users.name, role: users.role, isActive: users.isActive })
    .from(users).where(and(eq(users.tenantId, tenantId), inArray(users.role, ["EMPLOYEE", "PARTNER"])))
    .orderBy(asc(users.role), asc(users.name)));
  return rows.map((r) => ({ ...r, role: r.role as Person["role"] }));
}

async function loadPerson(tx: Tx, tenantId: string, personId: string) {
  const p = await tx.query.users.findFirst({
    where: and(eq(users.id, personId), eq(users.tenantId, tenantId), inArray(users.role, ["EMPLOYEE", "PARTNER"])),
  });
  if (!p) throw notFound("Person");
  return p;
}

function assertNotFuture(day?: string) {
  if (day && day > todayKey()) throw rule("Buchungsdatum darf nicht in der Zukunft liegen");
}

/** Heute = jetzt (Reihenfolge im Tagesjournal), sonst Mittag des gewählten Tages */
const bookingDateFor = (day?: string) => (day && day !== todayKey() ? dateInputToDate(day) : new Date());

const reversal = aliasedTable(ledgerEntries, "income_reversal");

interface DayIncome {
  id: string; accountKind: "CASH" | "BANK" | null; poolDeltaCents: number;
  description: string | null; bookingDate: Date; batchId: string | null;
}

async function incomesOn(tx: Tx, tenantId: string, day: string): Promise<DayIncome[]> {
  const { start, end } = dayRange(day);
  return tx.select({
    id: ledgerEntries.id, accountKind: ledgerEntries.accountKind, poolDeltaCents: ledgerEntries.poolDeltaCents,
    description: ledgerEntries.description, bookingDate: ledgerEntries.bookingDate, batchId: ledgerEntries.batchId,
  }).from(ledgerEntries)
    .leftJoin(reversal, eq(reversal.reversalOfId, ledgerEntries.id))
    .where(and(
      eq(ledgerEntries.tenantId, tenantId), eq(ledgerEntries.type, "INCOME_MANUAL"), isNull(reversal.id),
      gte(ledgerEntries.bookingDate, start), lt(ledgerEntries.bookingDate, end),
    ))
    .orderBy(asc(ledgerEntries.bookingDate));
}

const countOn = (rows: DayIncome[]) => ({
  CASH: rows.filter((r) => r.accountKind === "CASH").length,
  BANK: rows.filter((r) => r.accountKind === "BANK").length,
});

/**
 * Bereits gebuchte Tageseinnahmen getrennt je Konto. Die Warnung gilt nur für das jeweilige Konto:
 * cashWarning erscheint, wenn erneut Kasse gebucht wird – bankWarning entsprechend für die Bank.
 */
export async function dayIncomes(ctx: Ctx, day: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const rows = await withTenant(ctx, (tx) => incomesOn(tx, tenantId, day));
  const n = countOn(rows);
  const date = dateInputToDate(day);
  const sumOf = (a: "CASH" | "BANK") => rows.filter((r) => r.accountKind === a).reduce((s, r) => s + r.poolDeltaCents, 0);
  return {
    date: day,
    cash: { count: n.CASH, cents: sumOf("CASH"), warning: duplicateWarning("CASH", date, n.CASH) },
    bank: { count: n.BANK, cents: sumOf("BANK"), warning: duplicateWarning("BANK", date, n.BANK) },
    entries: rows,
  };
}

/** Buchbestand eines Kontos am Ende des Stichtags (inkl. aller Buchungen dieses Tages) */
export async function balanceAt(ctx: Ctx, day: string, account: "CASH" | "BANK") {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  assertNotFuture(day);
  return withTenant(ctx, async (tx) => ({
    date: day, accountKind: account,
    balanceCents: await accountBalance(tx, tenantId, account, dayRange(day).end),
    currentCents: await accountBalance(tx, tenantId, account),
  }));
}

/** Tageseinnahme Kasse und/oder Bank als eine gemeinsame Bewegung (gemeinsame batchId) */
export async function recordDailyIncome(ctx: Ctx, input: z.infer<typeof dailyIncomeSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  assertNotFuture(input.bookingDate);
  const parts = dailyIncomeParts(input.cashCents, input.bankCents);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const person = input.personId ? await loadPerson(tx, tenantId, input.personId) : null;
    const existing = countOn(await incomesOn(tx, tenantId, input.bookingDate));
    const batchId = parts.length > 1 ? randomUUID() : null;
    const bookingDate = bookingDateFor(input.bookingDate);
    const entries = [];
    for (const p of parts) {
      entries.push(await insertEntry(tx, ctx, tenantId, {
        type: "INCOME_MANUAL", ...deltasFor("INCOME_MANUAL", p.amountCents, p.account),
        employeeId: person?.id ?? null, batchId, bookingDate,
        description: [input.description, ACCOUNT_LABEL[p.account], person && `über ${person.name}`].filter(Boolean).join(" · "),
      }));
    }
    await audit(tx, ctx, "cash.daily-income", "LedgerEntry", entries[0].id, {
      batchId, date: input.bookingDate, cashCents: input.cashCents ?? 0, bankCents: input.bankCents ?? 0,
      personId: person?.id ?? null, existingCash: existing.CASH, existingBank: existing.BANK,
    });
    const booked = (a: "CASH" | "BANK") => parts.find((p) => p.account === a)?.amountCents ?? 0;
    return {
      entries, batchId, cashCents: booked("CASH"), bankCents: booked("BANK"),
      warnings: duplicateWarnings(dateInputToDate(input.bookingDate), existing, {
        cash: booked("CASH") > 0, bank: booked("BANK") > 0,
      }),
      cashBalanceCents: await cashBalance(tx, tenantId),
      bankBalanceCents: await bankBalance(tx, tenantId),
    };
  });
}

/**
 * Betriebsausgabe (z. B. Metro-Einkauf): Herkunft Kasse oder Bank – optional einer Person zugeordnet –
 * oder aus dem Budget eines Mitarbeiters. Ohne Beleg ist eine Begründung (≥ 10 Zeichen) Pflicht.
 */
export async function recordExpense(ctx: Ctx, input: z.infer<typeof expenseSchema>, file?: UploadFile | null) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  assertNotFuture(input.bookingDate);
  assertPurpose(input.purpose, !!file);
  if (input.fund === "BUDGET" && !input.personId) throw rule("Ausgabe aus dem Budget: bitte Person auswählen");
  const deltas = expenseDeltas(input.fund, input.amountCents);
  const stored = file ? await storeReceiptFile(tenantId, "expense-receipts", file) : null;
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const person = input.personId ? await loadPerson(tx, tenantId, input.personId) : null;
    if (input.fund === "BUDGET") {
      if (person!.role !== "EMPLOYEE") throw rule("Einkäufe von Gesellschaftern bitte unter Partner & Gesellschafter buchen (Kapital oder Budget)");
      const w = await walletBalance(tx, tenantId, person!.id);
      if (w < input.amountCents) throw insufficient(`Budget von ${person!.name}`, w);
    } else {
      const avail = await accountBalance(tx, tenantId, input.fund);
      if (avail < input.amountCents) throw insufficient(ACCOUNT_LABEL[input.fund], avail);
    }
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "EXPENSE", ...deltas, category: input.category,
      employeeId: person?.id ?? null, bookingDate: bookingDateFor(input.bookingDate),
      description: [categoryLabel(input.category), input.purpose.trim(), `aus ${FUND_LABEL[input.fund]}`, person && input.fund !== "BUDGET" && `durch ${person.name}`]
        .filter(Boolean).join(" · "),
    });
    if (stored) {
      await tx.insert(ledgerAttachments).values({
        tenantId, ledgerEntryId: entry.id, fileKey: stored.key, mime: stored.mime, name: stored.name, createdById: ctx.userId,
      });
    }
    await audit(tx, ctx, "cash.expense", "LedgerEntry", entry.id, {
      fund: input.fund, category: input.category, amountCents: input.amountCents, personId: person?.id ?? null, receipt: !!stored,
    });
    return {
      entry,
      cashBalanceCents: await cashBalance(tx, tenantId),
      bankBalanceCents: await bankBalance(tx, tenantId),
      walletBalanceCents: person ? await walletBalance(tx, tenantId, person.id) : null,
    };
  });
}

/**
 * Bestandskorrektur zum Stichtag: Buchbestand am Tagesende wird mit dem gezählten Ist-Bestand verglichen,
 * die Differenz wird als eigene Korrekturbuchung (ACCOUNT_ADJUST) am Stichtag erfasst.
 */
export async function correctBalance(ctx: Ctx, input: z.infer<typeof balanceCorrectionSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  assertNotFuture(input.date);
  const account = input.accountKind;
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const { end } = dayRange(input.date);
    const book = await accountBalance(tx, tenantId, account, end);
    const diff = correctionDiff(book, input.actualCents);
    const current = await accountBalance(tx, tenantId, account);
    if (current + diff < 0) throw insufficient(ACCOUNT_LABEL[account], current);
    // letzte Sekunde des Stichtags (heute: jetzt) – damit gilt der Ist-Bestand für das Tagesende
    const bookingDate = input.date === todayKey() ? new Date() : new Date(end.getTime() - 1000);
    const base = deltasFor("ACCOUNT_ADJUST", Math.abs(diff), account);
    const sign = diff < 0 ? -1 : 1;
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "ACCOUNT_ADJUST", ...base,
      poolDeltaCents: sign * base.poolDeltaCents, cashDeltaCents: sign * base.cashDeltaCents, bankDeltaCents: sign * base.bankDeltaCents,
      bookingDate, description: correctionText(account, bookingDate, book, input.actualCents, input.description),
    });
    await audit(tx, ctx, "account.correction", "LedgerEntry", entry.id, {
      accountKind: account, date: input.date, bookCents: book, actualCents: input.actualCents, diffCents: diff,
    });
    return {
      entry, bookCents: book, actualCents: input.actualCents, diffCents: diff,
      cashBalanceCents: await cashBalance(tx, tenantId), bankBalanceCents: await bankBalance(tx, tenantId),
    };
  });
}

export async function getLedgerAttachment(ctx: Ctx, ledgerEntryId: string) {
  requireRole(ctx, "ADMIN", "EMPLOYEE", "PARTNER");
  const tenantId = tid(ctx);
  const row = await withTenant(ctx, async (tx) => {
    const [a] = await tx.select({ a: ledgerAttachments, employeeId: ledgerEntries.employeeId })
      .from(ledgerAttachments).innerJoin(ledgerEntries, eq(ledgerEntries.id, ledgerAttachments.ledgerEntryId))
      .where(and(eq(ledgerAttachments.tenantId, tenantId), eq(ledgerAttachments.ledgerEntryId, ledgerEntryId)));
    return a;
  });
  if (!row) throw notFound("Beleg");
  if (ctx.role !== "ADMIN" && row.employeeId !== ctx.userId && !(ctx.role === "PARTNER" && ctx.canViewReports)) throw forbidden();
  const inline = parseReceiptDataUrl(row.a.fileKey);
  if (inline) return { data: inline.data, mime: inline.mime, name: row.a.name };
  try {
    return { data: await storage.get(row.a.fileKey), mime: row.a.mime, name: row.a.name };
  } catch (e) {
    if (isAppError(e)) throw e;
    throw notFound("Belegdatei");
  }
}
