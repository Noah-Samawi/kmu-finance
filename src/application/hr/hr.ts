import { and, desc, eq, lte } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { employeeProfiles, hrDocuments, payslips, tenants, users } from "@/infrastructure/db/schema";
import { conflict, notFound } from "@/domain/errors";
import { calculatePayslip, monthlyGrossFromHours } from "@/domain/payroll";
import { dateInputToDate } from "@/domain/period";
import { hrProfileSchema, payslipCreateSchema } from "@/lib/validation/schemas";
import { toReceiptDataUrl } from "../receipts/inline-file";
import { requireRole, tid, type Ctx } from "../context";
import { audit, loadEmployee } from "../ledger-service";
import { renderPayslipPdf, type PayslipPdfInput, type PayslipYtd } from "@/infrastructure/pdf/payslip-pdf";
import type { PayrollResult } from "@/domain/payroll";

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
type Profile = typeof employeeProfiles.$inferSelect | undefined;
type Tenant = typeof tenants.$inferSelect;

/** Jahressummen (Verdienstbescheinigung) aus allen Abrechnungen des Jahres bis einschließlich `month`. */
async function yearToDate(tx: Tx, tenantId: string, employeeId: string, year: number, month: number, extra?: PayrollResult): Promise<PayslipYtd> {
  const rows = await tx.select().from(payslips).where(and(
    eq(payslips.tenantId, tenantId), eq(payslips.employeeId, employeeId),
    eq(payslips.year, year), lte(payslips.month, month),
  ));
  const all = extra ? [...rows, extra] : rows;
  const sum = (k: keyof PayslipYtd) => all.reduce((s, r) => s + ((r as unknown as Record<string, number>)[k] ?? 0), 0);
  return {
    grossCents: sum("grossCents"), wageTaxCents: sum("wageTaxCents"), churchTaxCents: sum("churchTaxCents"),
    soliCents: sum("soliCents"), kvCents: sum("kvCents"), rvCents: sum("rvCents"), avCents: sum("avCents"), pvCents: sum("pvCents"),
  };
}

function payslipInput(
  calc: PayrollResult, t: Tenant, employee: { id: string; name: string }, profile: Profile,
  slip: { year: number; month: number; hoursWorked: number | null; hourlyRateCents: number; taxClass: number; childAllowances: number; churchTax: PayslipPdfInput["churchTax"]; issuedAt: Date },
  ytd: PayslipYtd,
): PayslipPdfInput {
  return {
    ...calc,
    employer: { name: t.name, legalName: t.legalName, street: t.street, zip: t.zip, city: t.city },
    employeeName: employee.name,
    employeeStreet: profile?.street, employeeZip: profile?.zip, employeeCity: profile?.city,
    year: slip.year, month: slip.month, hoursWorked: slip.hoursWorked, hourlyRateCents: slip.hourlyRateCents,
    taxClass: slip.taxClass, churchTax: slip.churchTax, childAllowances: slip.childAllowances,
    weeklyHours: profile?.weeklyHours != null ? Number(profile.weeklyHours) : null,
    kvAdditionalBp: profile?.kvAdditionalBp ?? 250,
    jobTitle: profile?.jobTitle ?? null, iban: profile?.iban ?? null, bic: profile?.bic ?? null,
    dateOfBirth: profile?.dateOfBirth ?? null, startDate: profile?.startDate ?? null,
    socialSecurityNumber: profile?.socialSecurityNumber ?? null, taxId: profile?.taxId ?? null,
    healthInsuranceName: profile?.healthInsuranceName ?? null,
    personnelNumber: `PN-${employee.id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    pgrs: "101", bgrs: "1111",
    issuedAt: slip.issuedAt,
    ytd,
  };
}

export async function getPersonnelFile(ctx: Ctx, employeeId: string) {
  if (ctx.role === "EMPLOYEE") employeeId = ctx.userId;
  else requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    if (ctx.role === "ADMIN") await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const profile = await tx.query.employeeProfiles.findFirst({
      where: and(eq(employeeProfiles.tenantId, tenantId), eq(employeeProfiles.userId, employeeId)),
    });
    const documents = await tx.select({
      id: hrDocuments.id, kind: hrDocuments.kind, title: hrDocuments.title,
      fileMime: hrDocuments.fileMime, notes: hrDocuments.notes, createdAt: hrDocuments.createdAt,
    }).from(hrDocuments)
      .where(and(eq(hrDocuments.tenantId, tenantId), eq(hrDocuments.employeeId, employeeId)))
      .orderBy(desc(hrDocuments.createdAt));
    const slips = await tx.select().from(payslips)
      .where(and(eq(payslips.tenantId, tenantId), eq(payslips.employeeId, employeeId)))
      .orderBy(desc(payslips.year), desc(payslips.month));
    return { profile: profile ?? null, documents, payslips: slips };
  });
}

export async function upsertProfile(ctx: Ctx, employeeId: string, input: z.infer<typeof hrProfileSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const values = {
      tenantId, userId: employeeId,
      dateOfBirth: input.dateOfBirth ? dateInputToDate(input.dateOfBirth) : null,
      nationality: input.nationality, street: input.street, zip: input.zip, city: input.city,
      taxId: input.taxId, socialSecurityNumber: input.socialSecurityNumber,
      taxClass: input.taxClass, childAllowances: input.childAllowances, churchTax: input.churchTax,
      healthInsuranceName: input.healthInsuranceName, kvAdditionalBp: input.kvAdditionalBp,
      iban: input.iban, bic: input.bic, jobTitle: input.jobTitle,
      startDate: input.startDate ? dateInputToDate(input.startDate) : null,
      weeklyHours: input.weeklyHours || null,
      hourlyRateCents: input.hourlyRateCents ?? 0,
      hoursPerMonth: input.hoursPerMonth || null,
      monthlyGrossCents: monthlyGrossFromHours(
        Number(String(input.hoursPerMonth ?? "").replace(",", ".")) || 0,
        input.hourlyRateCents ?? 0,
      ) || input.monthlyGrossCents || 0, notes: input.notes,
    };
    const existing = await tx.query.employeeProfiles.findFirst({ where: eq(employeeProfiles.userId, employeeId) });
    const [row] = existing
      ? await tx.update(employeeProfiles).set(values).where(eq(employeeProfiles.id, existing.id)).returning()
      : await tx.insert(employeeProfiles).values(values).returning();
    await audit(tx, ctx, "hr.profile", "EmployeeProfile", row.id);
    return row;
  });
}

export async function uploadHrDocument(
  ctx: Ctx, employeeId: string,
  meta: { kind: "ID" | "CONTRACT" | "TIMESHEET" | "TAX" | "PAYSLIP" | "OTHER"; title: string; notes?: string | null },
  file: { data: Buffer; mime: string; name: string },
) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const fileKey = toReceiptDataUrl(file.mime || "application/octet-stream", file.data);
    const [doc] = await tx.insert(hrDocuments).values({
      tenantId, employeeId, kind: meta.kind, title: meta.title.trim() || file.name,
      fileKey, fileMime: file.mime || "application/octet-stream", notes: meta.notes ?? null, createdById: ctx.userId,
    }).returning();
    await audit(tx, ctx, "hr.document", "HrDocument", doc.id);
    return { id: doc.id, kind: doc.kind, title: doc.title, createdAt: doc.createdAt };
  });
}

export async function getHrDocumentFile(ctx: Ctx, employeeId: string, docId: string) {
  if (ctx.role === "EMPLOYEE") employeeId = ctx.userId;
  else requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const doc = await tx.query.hrDocuments.findFirst({
      where: and(eq(hrDocuments.id, docId), eq(hrDocuments.tenantId, tenantId), eq(hrDocuments.employeeId, employeeId)),
    });
    if (!doc) throw notFound("Unterlage");
    const { parseReceiptDataUrl } = await import("../receipts/inline-file");
    const inline = parseReceiptDataUrl(doc.fileKey);
    if (!inline) throw notFound("Datei");
    return { data: inline.data, mime: doc.fileMime, name: doc.title };
  });
}

export async function createPayslip(ctx: Ctx, employeeId: string, input: z.infer<typeof payslipCreateSchema>) {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const emp = await loadEmployee(tx, tenantId, employeeId, { requireActive: false });
    const profile = await tx.query.employeeProfiles.findFirst({ where: eq(employeeProfiles.userId, employeeId) });
    const hours = input.hoursWorked ?? (profile?.hoursPerMonth != null ? Number(profile.hoursPerMonth) : undefined);
    const rate = input.hourlyRateCents ?? profile?.hourlyRateCents ?? 0;
    const fromHours = hours != null ? monthlyGrossFromHours(hours, rate) : 0;
    const gross = input.grossCents ?? (fromHours || profile?.monthlyGrossCents || 0);
    if (gross <= 0) throw conflict("Bitte Bruttolohn oder Stunden × Stundenlohn angeben");
    const calc = calculatePayslip({
      grossCents: gross,
      taxClass: profile?.taxClass ?? 1,
      childAllowances: profile?.childAllowances ?? 0,
      churchTax: profile?.churchTax ?? "NONE",
      kvAdditionalBp: profile?.kvAdditionalBp ?? 250,
    });
    const exists = await tx.query.payslips.findFirst({
      where: and(eq(payslips.tenantId, tenantId), eq(payslips.employeeId, employeeId), eq(payslips.year, input.year), eq(payslips.month, input.month)),
    });
    if (exists) throw conflict("Für diesen Monat existiert bereits eine Abrechnung");
    const t = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
    const ytd = await yearToDate(tx, tenantId, employeeId, input.year, input.month, calc);
    const pdf = await renderPayslipPdf(payslipInput(calc, t, emp, profile, {
      year: input.year, month: input.month, hoursWorked: hours ?? null, hourlyRateCents: rate,
      taxClass: profile?.taxClass ?? 1, childAllowances: profile?.childAllowances ?? 0,
      churchTax: profile?.churchTax ?? "NONE", issuedAt: new Date(),
    }, ytd));
    const pdfKey = toReceiptDataUrl("application/pdf", Buffer.from(pdf));
    const [row] = await tx.insert(payslips).values({
      tenantId, employeeId, year: input.year, month: input.month,
      hoursWorked: hours != null ? String(hours) : null, hourlyRateCents: rate,
      grossCents: calc.grossCents, rvCents: calc.rvCents, avCents: calc.avCents,
      kvCents: calc.kvCents, pvCents: calc.pvCents, wageTaxCents: calc.wageTaxCents,
      soliCents: calc.soliCents, churchTaxCents: calc.churchTaxCents, netCents: calc.netCents,
      taxClass: profile?.taxClass ?? 1,
      childAllowances: profile?.childAllowances ?? 0,
      churchTax: profile?.churchTax ?? "NONE",
      pdfKey, createdById: ctx.userId,
    }).returning();
    await audit(tx, ctx, "hr.payslip", "Payslip", row.id);
    return row;
  });
}

export async function getPayslipPdf(ctx: Ctx, employeeId: string, payslipId: string) {
  if (ctx.role === "EMPLOYEE") employeeId = ctx.userId;
  else requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  return withTenant(ctx, async (tx) => {
    const p = await tx.query.payslips.findFirst({
      where: and(eq(payslips.id, payslipId), eq(payslips.tenantId, tenantId), eq(payslips.employeeId, employeeId)),
    });
    if (!p) throw notFound("Lohnabrechnung");
    const emp = await tx.query.users.findFirst({ where: eq(users.id, employeeId) });
    const profile = await tx.query.employeeProfiles.findFirst({ where: eq(employeeProfiles.userId, employeeId) });
    const t = (await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) }))!;
    const calc = calculatePayslip({
      grossCents: p.grossCents, taxClass: p.taxClass, childAllowances: p.childAllowances,
      churchTax: p.churchTax, kvAdditionalBp: profile?.kvAdditionalBp ?? 250,
    });
    const hours = p.hoursWorked != null ? Number(p.hoursWorked) : null;
    const ytd = await yearToDate(tx, tenantId, employeeId, p.year, p.month);
    const pdf = await renderPayslipPdf(payslipInput(calc, t, { id: employeeId, name: emp?.name ?? "Mitarbeiter" }, profile, {
      year: p.year, month: p.month, hoursWorked: hours, hourlyRateCents: p.hourlyRateCents,
      taxClass: p.taxClass, childAllowances: p.childAllowances, churchTax: p.churchTax, issuedAt: p.createdAt,
    }, ytd));
    return { data: Buffer.from(pdf), mime: "application/pdf" as const, name: `lohnabrechnung-${p.year}-${String(p.month).padStart(2, "0")}.pdf` };
  });
}

