// Modul C: Belege einreichen (Mitarbeiter) und prüfen (Admin)
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { ledgerEntries, receipts, users } from "@/infrastructure/db/schema";
import { storage } from "@/infrastructure/storage";
import { AppError, badRequest, conflict, forbidden, notFound, rule } from "@/domain/errors";
import { deltasFor, reversalDeltas } from "@/domain/ledger";
import { dateInputToDate, todayKey } from "@/domain/period";
import { formatCents } from "@/domain/money";
import { receiptFieldsSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import { audit, insertEntry, walletBalance } from "../ledger-service";
import { ALLOWED_MIME, resolveReceiptMime } from "./mime";

export { ALLOWED_MIME };
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function putFile(key: string, data: Buffer, mime: string) {
  try {
    await storage.put(key, data, mime);
  } catch (e) {
    if (e instanceof AppError) throw e;
    console.error("storage.put failed", e);
    throw new AppError(503, "STORAGE", "Belegdatei konnte nicht gespeichert werden");
  }
}

async function getFile(key: string) {
  try {
    return await storage.get(key);
  } catch (e) {
    if (e instanceof AppError) throw e;
    console.error("storage.get failed", e);
    throw notFound("Belegdatei");
  }
}

/**
 * Beleg einreichen. Regel 2: Betrag wird SOFORT vom Guthaben abgezogen.
 * Regel 1: Guthaben darf nicht negativ werden -> Blockade.
 */
export async function submitReceipt(
  ctx: Ctx,
  input: z.infer<typeof receiptFieldsSchema>,
  file: { data: Buffer; mime: string },
) {
  requireRole(ctx, "EMPLOYEE");
  const tenantId = tid(ctx);
  const mime = resolveReceiptMime(file.mime, file.data);
  const ext = mime ? ALLOWED_MIME[mime] : undefined;
  if (!mime || !ext) throw badRequest("Dateityp nicht erlaubt (JPG, PNG, WEBP, HEIC oder PDF)");
  if (file.data.length === 0) throw badRequest("Datei ist leer");
  if (file.data.length > MAX_FILE_BYTES) throw badRequest("Datei ist größer als 10 MB");
  if (input.receiptDate > todayKey()) throw rule("Belegdatum darf nicht in der Zukunft liegen");
  const sha = createHash("sha256").update(file.data).digest("hex");

  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const dup = await tx.query.receipts.findFirst({
      where: and(eq(receipts.tenantId, tenantId), eq(receipts.fileSha256, sha)),
    });
    if (dup) throw conflict("Dieser Beleg wurde bereits hochgeladen");

    const balance = await walletBalance(tx, tenantId, ctx.userId);
    if (input.amountCents > balance) {
      throw rule(`Beleg (${formatCents(input.amountCents)}) übersteigt dein Guthaben (${formatCents(balance)}). Bitte bei der Geschäftsführung melden.`);
    }

    const fileKey = `${tenantId}/receipts/${ctx.userId}/${randomUUID()}.${ext}`;
    await putFile(fileKey, file.data, mime);
    const [r] = await tx.insert(receipts).values({
      tenantId, employeeId: ctx.userId, amountCents: input.amountCents, vatRate: input.vatRate ?? null,
      merchant: input.merchant, description: input.description,
      receiptDate: dateInputToDate(input.receiptDate),
      fileKey, fileMime: mime, fileSha256: sha,
    }).returning();
    await insertEntry(tx, ctx, tenantId, {
      type: "RECEIPT", ...deltasFor("RECEIPT", input.amountCents), employeeId: ctx.userId,
      receiptId: r.id, description: `${input.merchant}${input.description ? ` – ${input.description}` : ""}`,
    });
    await audit(tx, ctx, "receipt.submitted", "Receipt", r.id, { amountCents: input.amountCents });
    return { receipt: r, walletBalanceCents: balance - input.amountCents };
  });
}

/** Admin: alle Belege; Mitarbeiter: nur eigene (zusätzlich per RLS erzwungen) */
export async function listReceipts(ctx: Ctx, f: { status?: "SUBMITTED" | "APPROVED" | "REJECTED"; employeeId?: string } = {}) {
  requireRole(ctx, "ADMIN", "EMPLOYEE");
  const tenantId = tid(ctx);
  const employeeId = ctx.role === "EMPLOYEE" ? ctx.userId : f.employeeId;
  return withTenant(ctx, (tx) =>
    tx.select({
      id: receipts.id, amountCents: receipts.amountCents, merchant: receipts.merchant,
      description: receipts.description, receiptDate: receipts.receiptDate, status: receipts.status,
      rejectReason: receipts.rejectReason, createdAt: receipts.createdAt, fileMime: receipts.fileMime,
      reviewedAt: receipts.reviewedAt, employeeId: receipts.employeeId, employeeName: users.name,
    }).from(receipts)
      .innerJoin(users, eq(users.id, receipts.employeeId))
      .where(and(
        eq(receipts.tenantId, tenantId),
        employeeId ? eq(receipts.employeeId, employeeId) : undefined,
        f.status ? eq(receipts.status, f.status) : undefined,
      ))
      .orderBy(desc(receipts.createdAt))
      .limit(500),
  );
}

export async function getReceiptFile(ctx: Ctx, id: string) {
  requireRole(ctx, "ADMIN", "EMPLOYEE");
  const tenantId = tid(ctx);
  const r = await withTenant(ctx, (tx) =>
    tx.query.receipts.findFirst({ where: and(eq(receipts.id, id), eq(receipts.tenantId, tenantId)) }));
  if (!r) throw notFound("Beleg");
  if (ctx.role === "EMPLOYEE" && r.employeeId !== ctx.userId) throw forbidden();
  const ext = ALLOWED_MIME[r.fileMime] ?? "bin";
  return { data: await getFile(r.fileKey), mime: r.fileMime, name: `beleg-${r.id.slice(0, 8)}.${ext}` };
}

/**
 * Nachträgliche Prüfung. Ablehnen bucht den Betrag per Storno
 * zurück auf das Mitarbeiterkonto (Guthaben steigt wieder).
 */
export async function reviewReceipt(ctx: Ctx, id: string, action: "approve" | "reject", reason?: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const [r] = await tx.select().from(receipts)
      .where(and(eq(receipts.id, id), eq(receipts.tenantId, tenantId))).for("update");
    if (!r) throw notFound("Beleg");
    if (r.status === "REJECTED") throw rule("Beleg wurde bereits abgelehnt");
    if (action === "approve") {
      if (r.status === "APPROVED") throw rule("Beleg ist bereits freigegeben");
      await tx.update(receipts).set({ status: "APPROVED", reviewedById: ctx.userId, reviewedAt: new Date() })
        .where(eq(receipts.id, id));
    } else {
      const orig = await tx.query.ledgerEntries.findFirst({ where: eq(ledgerEntries.receiptId, id) });
      if (!orig) throw notFound("Belegbuchung");
      await insertEntry(tx, ctx, tenantId, {
        type: "REVERSAL", ...reversalDeltas(orig), employeeId: r.employeeId, reversalOfId: orig.id,
        description: `Beleg abgelehnt (${r.merchant}): ${reason}`,
      });
      await tx.update(receipts).set({
        status: "REJECTED", rejectReason: reason ?? null, reviewedById: ctx.userId, reviewedAt: new Date(),
      }).where(eq(receipts.id, id));
    }
    await audit(tx, ctx, `receipt.${action}d`, "Receipt", id, reason ? { reason } : undefined);
    return tx.query.receipts.findFirst({ where: eq(receipts.id, id) });
  });
}
