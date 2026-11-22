// Firmen-Belege (DATEV): Upload → Posteingang → OCR → prüfen/buchen → Ablage / Papierkorb.
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { belege, branches, ledgerAttachments, ledgerEntries } from "@/infrastructure/db/schema";
import { storage } from "@/infrastructure/storage";
import { badRequest, conflict, notFound, rule } from "@/domain/errors";
import { ACCOUNT_LABEL } from "@/domain/accounts";
import { BELEG_DOC_TYPES, type BelegDocType, type BelegLine, type BelegStatus } from "@/domain/beleg";
import { categoryLabel } from "@/domain/cash";
import { deltasFor } from "@/domain/ledger";
import { parseEuroToCents } from "@/domain/money";
import { dateInputToDate, dayRange, todayKey } from "@/domain/period";
import { splitVat, vatLedgerSign, type VatMode } from "@/domain/vat-booking";
import { requireRole, tid, type Ctx } from "../context";
import { accountBalance, audit, bankBalance, cashBalance, insertEntry, insufficient } from "../ledger-service";
import { assertBranch } from "../branches/assert-branch";
import { defaultCompanyId } from "../companies/resolve-company";
import { scanReceipt } from "../receipts/scan";
import { storeReceiptFile, type UploadFile } from "../receipts/store-file";

export const belegUploadMetaSchema = z.object({
  docType: z.enum(BELEG_DOC_TYPES).default("OTHER"),
  branchId: z.string().trim().max(64).optional().nullable().transform((v) => v || null),
});

export const belegBookSchema = z.object({
  direction: z.enum(["EXPENSE", "INCOME"]),
  accountKind: z.enum(["CASH", "BANK"]),
  branchId: z.string().trim().max(64).optional().nullable().transform((v) => v || null),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.union([z.number().int().positive(), z.string()]).transform((v, ctx) => {
    try {
      return typeof v === "number" ? v : parseEuroToCents(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "Betrag ungültig" });
      return z.NEVER;
    }
  }),
  vatRate: z.union([z.number(), z.string()]).optional().transform((v) => {
    if (v === undefined || v === null || v === "") return 0;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n)) return 0;
    // Prozent oder Basispunkte
    return n <= 20 ? Math.round(n) * 100 : Math.round(n);
  }),
  vatMode: z.enum(["GROSS", "NET"]).default("GROSS"),
  merchant: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
  receiptNumber: z.string().trim().max(80).optional().nullable().transform((v) => v || null),
  category: z.string().trim().max(40).optional().nullable().transform((v) => v || null),
  lines: z.array(z.object({
    amountCents: z.union([z.number(), z.string()]).transform((v) => (typeof v === "number" ? v : parseEuroToCents(String(v)))),
    vatRate: z.union([z.number(), z.string()]).transform((v) => {
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      return n <= 20 ? Math.round(n) * 100 : Math.round(n);
    }),
    category: z.string().trim().max(40).optional().nullable(),
  })).optional(),
});

export type BelegListFilter = {
  status?: BelegStatus | "ALL";
  branchId?: string | null;
  q?: string;
  from?: string;
  to?: string;
};

export async function countBelegInbox(ctx: Ctx) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(belege)
      .where(and(eq(belege.tenantId, tenantId), eq(belege.status, "INBOX")));
    return r?.n ?? 0;
  });
}

export async function listBelege(ctx: Ctx, f: BelegListFilter = {}) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const status = f.status && f.status !== "ALL" ? f.status : undefined;
    const from = f.from ? dayRange(f.from).start : undefined;
    const to = f.to ? dayRange(f.to).end : undefined;
    const q = f.q?.trim();
    const rows = await tx.select({
      id: belege.id, status: belege.status, docType: belege.docType, branchId: belege.branchId,
      branchName: branches.name, direction: belege.direction, accountKind: belege.accountKind,
      amountCents: belege.amountCents, vatRate: belege.vatRate, vatCents: belege.vatCents, vatMode: belege.vatMode,
      merchant: belege.merchant, description: belege.description, receiptNumber: belege.receiptNumber,
      category: belege.category, bookingDate: belege.bookingDate, fileMime: belege.fileMime,
      ocrStatus: belege.ocrStatus, lines: belege.lines, ledgerEntryId: belege.ledgerEntryId,
      createdAt: belege.createdAt, trashedAt: belege.trashedAt, filedAt: belege.filedAt,
    }).from(belege)
      .leftJoin(branches, eq(branches.id, belege.branchId))
      .where(and(
        eq(belege.tenantId, tenantId),
        status ? eq(belege.status, status) : inArray(belege.status, ["INBOX", "FILED"]),
        f.branchId === "none" ? sql`${belege.branchId} is null` : f.branchId ? eq(belege.branchId, f.branchId) : undefined,
        from ? gte(belege.createdAt, from) : undefined,
        to ? lt(belege.createdAt, to) : undefined,
        q ? or(
          ilike(belege.merchant, `%${q}%`),
          ilike(belege.description, `%${q}%`),
          ilike(belege.receiptNumber, `%${q}%`),
        ) : undefined,
      ))
      .orderBy(desc(belege.createdAt))
      .limit(500);
    return rows;
  });
}

export async function getBeleg(ctx: Ctx, id: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const [r] = await tx.select({
      id: belege.id, status: belege.status, docType: belege.docType, branchId: belege.branchId,
      branchName: branches.name, direction: belege.direction, accountKind: belege.accountKind,
      amountCents: belege.amountCents, vatRate: belege.vatRate, vatCents: belege.vatCents, vatMode: belege.vatMode,
      merchant: belege.merchant, description: belege.description, receiptNumber: belege.receiptNumber,
      category: belege.category, bookingDate: belege.bookingDate, fileKey: belege.fileKey,
      fileMime: belege.fileMime, fileName: belege.fileName, ocrStatus: belege.ocrStatus,
      ocrJson: belege.ocrJson, lines: belege.lines, ledgerEntryId: belege.ledgerEntryId,
      createdAt: belege.createdAt, trashedAt: belege.trashedAt, filedAt: belege.filedAt,
    }).from(belege)
      .leftJoin(branches, eq(branches.id, belege.branchId))
      .where(and(eq(belege.id, id), eq(belege.tenantId, tenantId)));
    if (!r) throw notFound("Beleg");
    return r;
  });
}

export async function getBelegFile(ctx: Ctx, id: string) {
  requireRole(ctx, "ADMIN");
  const b = await getBeleg(ctx, id);
  if (b.fileKey.startsWith("data:")) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(b.fileKey);
    if (!m) throw notFound("Datei");
    return { mime: m[1], data: Buffer.from(m[2], "base64"), name: b.fileName ?? "beleg" };
  }
  const data = await storage.get(b.fileKey);
  return { mime: b.fileMime, data, name: b.fileName ?? "beleg" };
}

/** Upload → Posteingang; OCR asynchron im Hintergrund (fire-and-forget nach Response). */
export async function uploadBeleg(ctx: Ctx, file: UploadFile, meta: z.infer<typeof belegUploadMetaSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const sha = createHash("sha256").update(file.data).digest("hex");
  const stored = await storeReceiptFile(tenantId, "belege", file);
  const row = await withTenant(ctx, async (tx) => {
    const dup = await tx.query.belege.findFirst({
      where: and(eq(belege.tenantId, tenantId), eq(belege.fileSha256, sha)),
    });
    if (dup && dup.status !== "TRASH") throw conflict("Dieser Beleg wurde bereits hochgeladen");
    const branchId = await assertBranch(tx, tenantId, meta.branchId);
    const companyId = await defaultCompanyId(tx, tenantId);
    const [r] = await tx.insert(belege).values({
      tenantId, companyId, status: "INBOX", docType: meta.docType, branchId,
      fileKey: stored.key, fileMime: stored.mime, fileName: stored.name, fileSha256: sha,
      ocrStatus: "PENDING", createdById: ctx.userId,
    }).returning();
    await audit(tx, ctx, "beleg.upload", "Beleg", r.id, { docType: meta.docType, branchId });
    return r;
  });
  // OCR im Hintergrund (nicht blockieren)
  void runBelegOcr(ctx, row.id).catch(() => undefined);
  return row;
}

export async function runBelegOcr(ctx: Ctx, id: string) {
  const tenantId = tid(ctx);
  const file = await getBelegFile(ctx, id);
  try {
    const hint = await scanReceipt({ data: file.data, mime: file.mime });
    await withTenant(ctx, async (tx) => {
      await tx.update(belege).set({
        ocrStatus: "DONE",
        ocrJson: hint as unknown as Record<string, unknown>,
        merchant: hint.merchant ?? undefined,
        description: hint.description ?? undefined,
        amountCents: hint.amountCents ?? undefined,
        vatRate: hint.vatRate ?? undefined,
        vatCents: hint.vatAmountCents ?? 0,
        bookingDate: hint.date ? dateInputToDate(hint.date) : undefined,
        category: hint.customCategory ?? hint.category ?? undefined,
        accountKind: hint.payment === "CASH" ? "CASH" : hint.payment === "CARD" ? "BANK" : undefined,
        direction: "EXPENSE",
        updatedAt: new Date(),
      }).where(and(eq(belege.id, id), eq(belege.tenantId, tenantId)));
    });
  } catch {
    await withTenant(ctx, async (tx) => {
      await tx.update(belege).set({ ocrStatus: "FAILED", updatedAt: new Date() })
        .where(and(eq(belege.id, id), eq(belege.tenantId, tenantId)));
    });
  }
}

export async function updateBelegDraft(ctx: Ctx, id: string, patch: Partial<z.infer<typeof belegBookSchema>> & { docType?: BelegDocType }) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const [b] = await tx.select().from(belege).where(and(eq(belege.id, id), eq(belege.tenantId, tenantId))).for("update");
    if (!b) throw notFound("Beleg");
    if (b.status === "FILED") throw rule("Verbuchter Beleg kann nicht mehr geändert werden");
    if (b.status === "TRASH") throw rule("Beleg liegt im Papierkorb – bitte zuerst wiederherstellen");
    const branchId = patch.branchId !== undefined ? await assertBranch(tx, tenantId, patch.branchId) : undefined;
    const [r] = await tx.update(belege).set({
      direction: patch.direction ?? b.direction,
      accountKind: patch.accountKind ?? b.accountKind,
      branchId: branchId !== undefined ? branchId : b.branchId,
      bookingDate: patch.bookingDate ? dateInputToDate(patch.bookingDate) : b.bookingDate,
      amountCents: patch.amountCents ?? b.amountCents,
      vatRate: patch.vatRate ?? b.vatRate,
      vatMode: patch.vatMode ?? b.vatMode,
      merchant: patch.merchant ?? b.merchant,
      description: patch.description !== undefined ? patch.description : b.description,
      receiptNumber: patch.receiptNumber !== undefined ? patch.receiptNumber : b.receiptNumber,
      category: patch.category !== undefined ? patch.category : b.category,
      lines: patch.lines ?? b.lines,
      docType: patch.docType ?? b.docType,
      updatedAt: new Date(),
    }).where(eq(belege.id, id)).returning();
    return r;
  });
}

/** Speichern & Buchen: Einnahme/Ausgabe auf Kasse/Bank, Beleg → Ablage */
export async function bookBeleg(ctx: Ctx, id: string, input: z.infer<typeof belegBookSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  if (input.bookingDate > todayKey()) throw rule("Buchungsdatum darf nicht in der Zukunft liegen");
  const lines: BelegLine[] = input.lines?.length
    ? input.lines.map((l) => ({ amountCents: l.amountCents, vatRate: l.vatRate, category: l.category ?? null }))
    : [{ amountCents: input.amountCents, vatRate: input.vatRate ?? 0, category: input.category ?? null }];
  if (!lines.every((l) => l.amountCents > 0)) throw rule("Jede Position braucht einen Betrag > 0");

  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const [b] = await tx.select().from(belege).where(and(eq(belege.id, id), eq(belege.tenantId, tenantId))).for("update");
    if (!b) throw notFound("Beleg");
    if (b.status !== "INBOX") throw rule("Nur Belege im Posteingang können gebucht werden");
    if (b.ledgerEntryId) throw rule("Beleg ist bereits verbucht");

    const branchId = await assertBranch(tx, tenantId, input.branchId);
    const account = input.accountKind;
    const vatMode = (input.vatMode ?? "GROSS") as VatMode;
    const splits = lines.map((l) => ({ ...l, vat: splitVat(l.amountCents, l.vatRate, vatMode) }));
    const payCents = splits.reduce((s, p) => s + p.vat.grossCents, 0);

    if (input.direction === "EXPENSE") {
      const avail = await accountBalance(tx, tenantId, account);
      if (avail < payCents) throw insufficient(ACCOUNT_LABEL[account], avail);
    }

    const batchId = splits.length > 1 ? randomUUID() : null;
    const bookingDate = dateInputToDate(input.bookingDate);
    const entries = [];
    for (const p of splits) {
      const type = input.direction === "INCOME" ? "INCOME_MANUAL" as const : "EXPENSE" as const;
      const deltas = input.direction === "INCOME"
        ? deltasFor("INCOME_MANUAL", p.vat.grossCents, account)
        : deltasFor("EXPENSE", p.vat.grossCents, account);
      entries.push(await insertEntry(tx, ctx, tenantId, {
        type, ...deltas, category: input.direction === "EXPENSE" ? (p.category ?? input.category ?? "SONSTIGES") : null,
        branchId, batchId, bookingDate,
        vatRate: p.vat.vatRate || null,
        vatCents: vatLedgerSign(input.direction === "INCOME" ? "INCOME" : "EXPENSE", p.vat.vatCents),
        vatMode: p.vat.vatRate ? p.vat.mode : null,
        description: [
          input.direction === "INCOME" ? "Einnahme (Beleg)" : categoryLabel(p.category ?? input.category ?? "SONSTIGES"),
          input.merchant,
          input.description,
          input.receiptNumber && `Beleg-Nr. ${input.receiptNumber}`,
          p.vat.vatCents ? `${p.vat.vatRate / 100} % MwSt.` : null,
        ].filter(Boolean).join(" · "),
      }));
    }

    await tx.insert(ledgerAttachments).values({
      tenantId, ledgerEntryId: entries[0].id, fileKey: b.fileKey, mime: b.fileMime,
      name: b.fileName ?? "beleg", createdById: ctx.userId,
    });

    await tx.update(belege).set({
      status: "FILED",
      direction: input.direction,
      accountKind: account,
      branchId,
      bookingDate,
      amountCents: payCents,
      vatRate: splits[0].vat.vatRate,
      vatCents: splits.reduce((s, p) => s + p.vat.vatCents, 0),
      vatMode,
      merchant: input.merchant,
      description: input.description,
      receiptNumber: input.receiptNumber,
      category: input.category,
      lines,
      ledgerEntryId: entries[0].id,
      batchId,
      filedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(belege.id, id));

    await audit(tx, ctx, "beleg.book", "Beleg", id, {
      direction: input.direction, account, payCents, ledgerEntryId: entries[0].id, batchId,
    });

    return {
      belegId: id,
      entries,
      cashBalanceCents: await cashBalance(tx, tenantId),
      bankBalanceCents: await bankBalance(tx, tenantId),
    };
  });
}

export async function trashBelege(ctx: Ctx, ids: string[]) {
  requireRole(ctx, "ADMIN");
  if (!ids.length) throw badRequest("Keine Belege ausgewählt");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    // Soft-Archiv: auch FILED → Papierkorb (Hauptbuch bleibt; Storno ggf. separat)
    const updated = await tx.update(belege).set({ status: "TRASH", trashedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(belege.tenantId, tenantId),
        inArray(belege.id, ids),
        inArray(belege.status, ["INBOX", "FILED"]),
      ))
      .returning({ id: belege.id });
    if (!updated.length) throw badRequest("Keine Belege zum Verschieben");
    await audit(tx, ctx, "beleg.trash", "Beleg", ids[0], { ids, count: updated.length });
    return { count: updated.length };
  });
}

export async function restoreBelege(ctx: Ctx, ids: string[]) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const rows = await tx.select({ id: belege.id, ledgerEntryId: belege.ledgerEntryId }).from(belege)
      .where(and(eq(belege.tenantId, tenantId), inArray(belege.id, ids), eq(belege.status, "TRASH")));
    for (const r of rows) {
      await tx.update(belege).set({
        status: r.ledgerEntryId ? "FILED" : "INBOX",
        trashedAt: null,
        updatedAt: new Date(),
      }).where(eq(belege.id, r.id));
    }
    await audit(tx, ctx, "beleg.restore", "Beleg", ids[0], { ids, count: rows.length });
    return { count: rows.length };
  });
}

export async function purgeBelege(ctx: Ctx, ids: string[]) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const rows = await tx.select().from(belege)
      .where(and(eq(belege.tenantId, tenantId), inArray(belege.id, ids), eq(belege.status, "TRASH")));
    if (rows.length !== ids.length) throw rule("Nur Belege im Papierkorb können endgültig gelöscht werden");
    await tx.delete(belege).where(and(eq(belege.tenantId, tenantId), inArray(belege.id, ids)));
    await audit(tx, ctx, "beleg.purge", "Beleg", ids[0], { ids, count: ids.length });
    return { count: ids.length };
  });
}

/**
 * Beleg aus dem Posteingang an eine bestehende Kasse/Bank-Buchung hängen –
 * ohne neue Buchung (keine Doppelbuchung). Beleg → Belegablage.
 */
export async function attachBelegToEntry(ctx: Ctx, belegId: string, ledgerEntryId: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const [b] = await tx.select().from(belege)
      .where(and(eq(belege.id, belegId), eq(belege.tenantId, tenantId))).for("update");
    if (!b) throw notFound("Beleg");
    if (b.status !== "INBOX") throw rule("Nur Belege im Posteingang können zugeordnet werden");
    if (b.ledgerEntryId) throw rule("Beleg ist bereits einer Buchung zugeordnet");

    const entry = await tx.query.ledgerEntries.findFirst({
      where: and(eq(ledgerEntries.id, ledgerEntryId), eq(ledgerEntries.tenantId, tenantId)),
    });
    if (!entry) throw notFound("Buchung");
    if (entry.closingId) throw rule("Buchung liegt in einem abgeschlossenen Monat");

    const existingAtt = await tx.query.ledgerAttachments.findFirst({
      where: eq(ledgerAttachments.ledgerEntryId, ledgerEntryId),
    });
    if (existingAtt) throw rule("Diese Buchung hat bereits einen Beleg");

    const taken = await tx.query.belege.findFirst({
      where: and(eq(belege.ledgerEntryId, ledgerEntryId), eq(belege.tenantId, tenantId)),
    });
    if (taken) throw rule("Diese Buchung ist bereits mit einem Beleg verknüpft");

    await tx.insert(ledgerAttachments).values({
      tenantId,
      ledgerEntryId,
      fileKey: b.fileKey,
      mime: b.fileMime,
      name: b.fileName ?? "beleg",
      createdById: ctx.userId,
    });

    await tx.update(belege).set({
      status: "FILED",
      ledgerEntryId,
      filedAt: new Date(),
      updatedAt: new Date(),
      // Metadaten aus der Buchung übernehmen, falls Beleg noch leer
      direction: b.direction ?? (entry.cashDeltaCents + entry.bankDeltaCents >= 0 ? "INCOME" : "EXPENSE"),
      accountKind: b.accountKind ?? entry.accountKind,
      amountCents: b.amountCents ?? Math.abs(entry.cashDeltaCents || entry.bankDeltaCents),
      bookingDate: b.bookingDate ?? entry.bookingDate,
      branchId: b.branchId ?? entry.branchId,
      merchant: b.merchant ?? entry.description,
      category: b.category ?? entry.category,
    }).where(eq(belege.id, belegId));

    await audit(tx, ctx, "beleg.attach", "Beleg", belegId, { ledgerEntryId });
    return { belegId, ledgerEntryId };
  });
}

/**
 * Verknüpften Beleg von einer Buchung lösen.
 * belegTo: INBOX = nur Datei weg (erneut zuordenbar); TRASH = Beleg in Papierkorb.
 */
export async function detachBelegFromEntry(
  ctx: Ctx,
  ledgerEntryId: string,
  opts: { belegTo?: "INBOX" | "TRASH" } = {},
) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const belegTo = opts.belegTo ?? "INBOX";
  return withTenant(ctx, async (tx) => {
    const att = await tx.query.ledgerAttachments.findFirst({
      where: and(eq(ledgerAttachments.ledgerEntryId, ledgerEntryId), eq(ledgerAttachments.tenantId, tenantId)),
    });
    if (!att) throw notFound("Belegdatei");

    await tx.delete(ledgerAttachments).where(eq(ledgerAttachments.id, att.id));

    const linked = await tx.query.belege.findFirst({
      where: and(eq(belege.ledgerEntryId, ledgerEntryId), eq(belege.tenantId, tenantId)),
    });
    if (linked) {
      await tx.update(belege).set({
        status: belegTo,
        ledgerEntryId: null,
        filedAt: null,
        trashedAt: belegTo === "TRASH" ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(belege.id, linked.id));
    }

    await audit(tx, ctx, "beleg.detach", "LedgerEntry", ledgerEntryId, { belegId: linked?.id ?? null, belegTo });
    return { ledgerEntryId, belegId: linked?.id ?? null };
  });
}
