// Modul C: Belege einreichen (Mitarbeiter) und prüfen (Admin)
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { lockTenantLedger, withTenant } from "@/infrastructure/db/tenant-tx";
import { ledgerEntries, receipts, users } from "@/infrastructure/db/schema";
import { blobToken, storage, storageDiagnostics } from "@/infrastructure/storage";
import { AppError, isAppError, badRequest, conflict, forbidden, notFound, rule } from "@/domain/errors";
import { deltasFor, reversalDeltas } from "@/domain/ledger";
import { dateInputToDate, todayKey } from "@/domain/period";
import { formatCents } from "@/domain/money";
import { receiptFieldsSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import { audit, insertEntry, walletBalance } from "../ledger-service";
import { ALLOWED_MIME, resolveReceiptMime } from "./mime";
import { parseReceiptDataUrl, toReceiptDataUrl } from "./inline-file";

export { ALLOWED_MIME };
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

function pgCode(e: unknown): string | undefined {
  if (typeof e === "object" && e && "code" in e && typeof (e as { code: unknown }).code === "string") {
    return (e as { code: string }).code;
  }
  const cause = (e as { cause?: { code?: string } })?.cause;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

async function putFile(key: string, data: Buffer, mime: string) {
  const diag = storageDiagnostics();
  try {
    console.info("[receipts] storage.put", { key, bytes: data.length, mime, ...diag });
    await storage.put(key, data, mime);
  } catch (e) {
    if (isAppError(e)) throw e;
    console.error("[receipts] STORAGE Fehler (Blob/S3/lokal)", {
      key,
      ...diag,
      name: e instanceof Error ? e.name : typeof e,
      message: e instanceof Error ? e.message : String(e),
    });
    throw new AppError(503, "STORAGE", `Belegdatei konnte nicht gespeichert werden (${diag.backend})`);
  }
}

async function getFile(key: string) {
  try {
    return await storage.get(key);
  } catch (e) {
    if (isAppError(e)) throw e;
    console.error("[receipts] STORAGE Lesefehler", { key, ...storageDiagnostics(), message: e instanceof Error ? e.message : String(e) });
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
  const storeInline = !blobToken();
  const fileKey = storeInline
    ? toReceiptDataUrl(mime, file.data)
    : `${tenantId}/receipts/${ctx.userId}/${randomUUID()}.${ext}`;

  if (storeInline) {
    console.info("[receipts] kein Blob-Token – Datei als Base64-Data-URL in PostgreSQL (Receipt.fileKey)", {
      bytes: file.data.length,
      mime,
      dataUrlChars: fileKey.length,
    });
  } else {
    // Blob außerhalb der DB-Transaktion: sonst hält ein langsamer Upload den Ledger-Lock.
    await putFile(fileKey, file.data, mime);
  }

  try {
    return await withTenant(ctx, async (tx) => {
      await lockTenantLedger(tx, tenantId);
      const dup = await tx.query.receipts.findFirst({
        where: and(eq(receipts.tenantId, tenantId), eq(receipts.fileSha256, sha)),
      });
      if (dup) throw conflict("Dieser Beleg wurde bereits hochgeladen");

      const balance = await walletBalance(tx, tenantId, ctx.userId);
      if (input.amountCents > balance) {
        throw rule(`Beleg (${formatCents(input.amountCents)}) übersteigt dein Guthaben (${formatCents(balance)}). Bitte bei der Geschäftsführung melden.`);
      }

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
  } catch (e) {
    if (isAppError(e)) throw e;
    const code = pgCode(e);
    console.error("[receipts] DATABASE Fehler", {
      fileKey: storeInline ? "(inline-data-url)" : fileKey,
      pgCode: code,
      ...storageDiagnostics(),
      name: e instanceof Error ? e.name : typeof e,
      message: e instanceof Error ? e.message : String(e),
    });
    throw new AppError(
      503,
      "DATABASE",
      `Datenbankfehler beim Speichern des Belegs${code ? ` (${code})` : ""}`,
    );
  }
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
  const inline = parseReceiptDataUrl(r.fileKey);
  const data = inline ? inline.data : await getFile(r.fileKey);
  return { data, mime: r.fileMime, name: `beleg-${r.id.slice(0, 8)}.${ext}` };
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
