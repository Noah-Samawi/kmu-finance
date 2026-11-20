// Admin: Mitarbeiter anlegen (mit oder ohne Login), sperren, löschen, Lohn auszahlen
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, lockTenantLedger } from "@/infrastructure/db/tenant-tx";
import { employeeProfiles, hrDocuments, ledgerEntries, memberships, users } from "@/infrastructure/db/schema";
import { destroyAllSessionsOfUser, hashPassword } from "@/infrastructure/auth/session";
import { conflict, notFound, rule } from "@/domain/errors";
import { ACCOUNT_LABEL } from "@/domain/accounts";
import { expenseDeltas } from "@/domain/cash";
import { dateInputToDate } from "@/domain/period";
import { employeeCreateSchema, employeeUpdateSchema, wagePayoutSchema } from "@/lib/validation/schemas";
import { requireRole, tid, type Ctx } from "../context";
import {
  accountBalance, audit, bankBalance, cashBalance, claimBalance, claimBalancesByEmployee,
  insertEntry, insufficient, loadEmployee, walletBalance, walletBalancesByEmployee,
} from "../ledger-service";
import { assertBranch } from "../branches/assert-branch";
import { toReceiptDataUrl } from "../receipts/inline-file";
import { notHidden } from "../reports/reports";

const publicCols = {
  id: users.id, name: users.name, email: users.email, isActive: users.isActive, canLogin: users.canLogin,
  canEnterCashExpense: users.canEnterCashExpense, canEnterOutlay: users.canEnterOutlay,
  lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
};

export async function listEmployees(ctx: Ctx) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const list = await tx.select(publicCols).from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, "EMPLOYEE")))
      .orderBy(asc(users.name));
    const balances = await walletBalancesByEmployee(tx, tenantId);
    const claims = await claimBalancesByEmployee(tx, tenantId);
    return list.map((e) => {
      const wallet = balances.get(e.id) ?? 0;
      const claim = claims.get(e.id) ?? 0;
      return { ...e, balanceCents: wallet, claimCents: claim, firmBalanceCents: claim - wallet };
    });
  });
}

export async function getEmployee(ctx: Ctx, employeeId: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const e = await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const wallet = await walletBalance(tx, tenantId, e.id);
    const claim = await claimBalance(tx, tenantId, e.id);
    return {
      id: e.id, name: e.name, email: e.email, isActive: e.isActive, canLogin: e.canLogin,
      canEnterCashExpense: e.canEnterCashExpense, canEnterOutlay: e.canEnterOutlay,
      lastLoginAt: e.lastLoginAt,
      createdAt: e.createdAt, balanceCents: wallet, claimCents: claim, firmBalanceCents: claim - wallet,
    };
  });
}

/** Mitarbeiter anlegen – Login nur bei withLogin (Außendienst). Stammdaten → Personalakte. */
export async function createEmployee(ctx: Ctx, input: z.infer<typeof employeeCreateSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const withLogin = !!input.withLogin;
  return withTenant(ctx, async (tx) => {
    let email: string;
    let passwordHash: string;
    if (withLogin) {
      if (!input.email || !input.password) throw rule("E-Mail und Passwort für den Login fehlen");
      if (await tx.query.users.findFirst({ where: eq(users.email, input.email) })) {
        throw conflict("E-Mail ist bereits registriert");
      }
      email = input.email;
      passwordHash = await hashPassword(input.password);
    } else {
      email = `nologin-${randomUUID()}@no-login.local`;
      passwordHash = await hashPassword(randomBytes(24).toString("base64url"));
    }
    const [u] = await tx.insert(users).values({
      tenantId, role: "EMPLOYEE", name: input.name, email, passwordHash,
      canLogin: withLogin,
      canEnterCashExpense: withLogin, canEnterOutlay: withLogin,
    }).returning(publicCols);

    const branchId = input.branchId ? await assertBranch(tx, tenantId, input.branchId) : null;
    const { resolveCompanyId } = await import("../companies/resolve-company");
    const companyId = await resolveCompanyId(tx, tenantId, branchId);
    await tx.insert(memberships).values({
      id: randomUUID(), tenantId, userId: u.id, companyId, branchId, role: "EMPLOYEE",
    });
    const noteParts = [
      input.phone ? `Telefon: ${input.phone}` : null,
      branchId ? `Filiale-ID: ${branchId}` : null,
    ].filter(Boolean);
    const hasProfile = !!(input.street || input.zip || input.city || input.taxId || input.socialSecurityNumber
      || input.iban || input.jobTitle || input.startDate || input.dateOfBirth || input.monthlyGrossCents
      || noteParts.length);
    if (hasProfile) {
      await tx.insert(employeeProfiles).values({
        tenantId, companyId, userId: u.id,
        street: input.street, zip: input.zip, city: input.city,
        taxId: input.taxId, socialSecurityNumber: input.socialSecurityNumber,
        iban: input.iban, jobTitle: input.jobTitle,
        startDate: input.startDate ? dateInputToDate(input.startDate) : null,
        dateOfBirth: input.dateOfBirth ? dateInputToDate(input.dateOfBirth) : null,
        monthlyGrossCents: input.monthlyGrossCents ?? 0,
        notes: noteParts.length ? noteParts.join("\n") : null,
      });
    }
    await audit(tx, ctx, "employee.created", "User", u.id, { withLogin, branchId, companyId });
    return u;
  });
}

/** Sperren beendet alle laufenden Sessions sofort */
export async function updateEmployee(ctx: Ctx, employeeId: string, input: z.infer<typeof employeeUpdateSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const result = await withTenant(ctx, async (tx) => {
    await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    if (input.canEnterCashExpense !== undefined) patch.canEnterCashExpense = input.canEnterCashExpense;
    if (input.canEnterOutlay !== undefined) patch.canEnterOutlay = input.canEnterOutlay;
    if (input.canLogin !== undefined) patch.canLogin = input.canLogin;
    if (input.email !== undefined) {
      const clash = await tx.query.users.findFirst({ where: and(eq(users.email, input.email), ne(users.id, employeeId)) });
      if (clash) throw conflict("E-Mail ist bereits registriert");
      patch.email = input.email;
    }
    if (input.password) {
      patch.passwordHash = await hashPassword(input.password);
      patch.canLogin = true;
    }
    const [u] = await tx.update(users).set(patch).where(eq(users.id, employeeId)).returning(publicCols);
    await audit(tx, ctx, input.isActive === false ? "employee.locked" : input.isActive ? "employee.unlocked" : "employee.updated",
      "User", employeeId, { passwordReset: !!input.password });
    return u;
  });
  if (input.isActive === false || input.password || input.canLogin === false) await destroyAllSessionsOfUser(employeeId);
  return result;
}

/**
 * Löschen: ohne Buchungen hart löschen (Cascade Profile/Docs/Sessions).
 * Mit Buchungen: nur deaktivieren (GoBD – Historie bleibt). Bestätigung = exakter Name.
 */
export async function deleteEmployee(ctx: Ctx, employeeId: string, confirmName: string) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const e = await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    if (confirmName.trim() !== e.name) throw rule(`Zur Bestätigung bitte den Namen „${e.name}“ eintippen`);
    const [cnt] = await tx.select({ n: sql<number>`count(*)::int` }).from(ledgerEntries)
      .where(and(eq(ledgerEntries.tenantId, tenantId), eq(ledgerEntries.employeeId, employeeId)));
    if (cnt.n > 0) {
      await tx.update(users).set({ isActive: false, canLogin: false }).where(eq(users.id, employeeId));
      await destroyAllSessionsOfUser(employeeId);
      await audit(tx, ctx, "employee.deactivated", "User", employeeId, { reason: "Löschen mit vorhandenen Buchungen" });
      return { deleted: false, deactivated: true, name: e.name, bookings: cnt.n };
    }
    await tx.delete(users).where(eq(users.id, employeeId));
    await audit(tx, ctx, "employee.deleted", "User", employeeId, { name: e.name });
    return { deleted: true, deactivated: false, name: e.name, bookings: 0 };
  });
}

/** Lohn auszahlen / überweisen: belastet Kasse oder Bank, legt Nachweis in der Personalakte ab */
export async function payWage(
  ctx: Ctx, employeeId: string, input: z.infer<typeof wagePayoutSchema>,
  file?: { data: Buffer; mime: string; name: string } | null,
) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await lockTenantLedger(tx, tenantId);
    const e = await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const avail = await accountBalance(tx, tenantId, input.fund);
    if (avail < input.amountCents) throw insufficient(ACCOUNT_LABEL[input.fund], avail);
    const branchId = await assertBranch(tx, tenantId, input.branchId);
    const bookingDate = input.bookingDate ? dateInputToDate(input.bookingDate) : new Date();
    const purpose = (input.description?.trim() || `Lohnauszahlung ${e.name}`).slice(0, 300);
    const entry = await insertEntry(tx, ctx, tenantId, {
      type: "EXPENSE", ...expenseDeltas(input.fund, input.amountCents),
      category: "LOHN", employeeId: e.id, branchId, bookingDate,
      description: [`Lohn für Mitarbeiter`, purpose, `aus ${ACCOUNT_LABEL[input.fund]}`, `an ${e.name}`].join(" · "),
    });
    const title = `Lohnauszahlung ${bookingDate.toISOString().slice(0, 10)}`;
    const fileKey = file
      ? toReceiptDataUrl(file.mime || "application/octet-stream", file.data)
      : toReceiptDataUrl("text/plain", Buffer.from(
        `Lohnauszahlung\nMitarbeiter: ${e.name}\nBetrag: ${(input.amountCents / 100).toFixed(2)} EUR\nKonto: ${ACCOUNT_LABEL[input.fund]}\nDatum: ${bookingDate.toISOString().slice(0, 10)}\nBuchung: ${entry.id}\n`,
        "utf8",
      ));
    await tx.insert(hrDocuments).values({
      tenantId, employeeId: e.id, kind: "PAYSLIP", title,
      fileKey, fileMime: file?.mime || "text/plain",
      notes: `Automatisch bei Lohnauszahlung · Ledger ${entry.id}`, createdById: ctx.userId,
    });
    await audit(tx, ctx, "employee.wage", "LedgerEntry", entry.id, {
      employeeId: e.id, fund: input.fund, amountCents: input.amountCents,
    });
    return {
      entry,
      cashBalanceCents: await cashBalance(tx, tenantId),
      bankBalanceCents: await bankBalance(tx, tenantId),
    };
  });
}
