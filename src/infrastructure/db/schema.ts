// =====================================================================
// Datenbankschema (Drizzle ORM / PostgreSQL)
// 1:1-Umsetzung des ursprünglichen Prisma-Modells.
//
// Grundprinzipien:
//  1. Jede fachliche Tabelle hat tenantId  -> Mandantentrennung
//  2. Geld immer als Integer in Cent       -> keine Rundungsfehler
//  3. Salden werden NIE gespeichert, sondern aus LedgerEntry summiert
//  4. Buchungen werden nie gelöscht/geändert, nur storniert (GoBD)
// =====================================================================
import {
  pgTable, pgEnum, text, integer, boolean, timestamp, jsonb, numeric,
  uniqueIndex, index, primaryKey, type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";

const id = () => text("id").primaryKey().$defaultFn(() => randomUUID());
const createdAt = () => timestamp("createdAt", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

// ---------------------------------------------------------------------
// ENUMS
// ---------------------------------------------------------------------
export const roleEnum = pgEnum("Role", ["SUPER_ADMIN", "ADMIN", "EMPLOYEE", "PARTNER"]);
export const tenantStatusEnum = pgEnum("TenantStatus", ["ACTIVE", "SUSPENDED"]);
export const contactTypeEnum = pgEnum("ContactType", ["CUSTOMER", "SUPPLIER", "BOTH"]);
// "Überfällig" wird NICHT gespeichert: OPEN && dueDate < heute
export const invoiceStatusEnum = pgEnum("InvoiceStatus", ["DRAFT", "OPEN", "PAID", "CANCELED"]);
export const ledgerTypeEnum = pgEnum("LedgerType", [
  "INCOME_INVOICE", // Pool +            (bezahlte Rechnung)
  "INCOME_MANUAL",  // Pool +            (manuelle Einnahme)
  "ALLOCATION",     // Pool -, Wallet +  (Budget an Mitarbeiter)
  "RECEIPT",        // Wallet -          (Beleg eingereicht)
  "ADJUSTMENT",     // Wallet -          (Ausgabe ohne Beleg)
  "RETURN",         // Wallet -, Pool +  (Restgeld zurück)
  "REVERSAL",       // negierte Deltas einer anderen Buchung
  "CASH_WITHDRAWAL", // Bank -, Kasse +  (Geldautomat, kein Aufwand)
  "ACCOUNT_ADJUST", // manuelle Korrektur Kasse oder Bank
  "EMPLOYEE_OUTLAY", // Anspruch MA +   (privates Geld für Firma)
  "OUTLAY_REPAY",    // Anspruch MA -, Kasse/Bank - (Erstattung)
  "PARTNER_DEPOSIT", // Einlage Gesellschafter
  "PARTNER_DRAW",    // Entnahme Gesellschafter
  "PARTNER_PROFIT",  // Gewinnanteil
]);
export const paymentMethodEnum = pgEnum("PaymentMethod", ["TRANSFER", "CASH"]);
export const accountKindEnum = pgEnum("AccountKind", ["CASH", "BANK"]);
export const hrDocKindEnum = pgEnum("HrDocKind", ["ID", "CONTRACT", "TIMESHEET", "TAX", "PAYSLIP", "OTHER"]);
export const reconcileStatusEnum = pgEnum("ReconcileStatus", ["GREEN", "RED", "CASH_WITHDRAWAL"]);
export const churchTaxEnum = pgEnum("ChurchTax", ["NONE", "EIGHT", "NINE"]);
export const receiptStatusEnum = pgEnum("ReceiptStatus", ["SUBMITTED", "APPROVED", "REJECTED"]);
export const periodTypeEnum = pgEnum("PeriodType", ["DAY", "MONTH"]);

// ---------------------------------------------------------------------
// MANDANT & BENUTZER
// ---------------------------------------------------------------------
export const tenants = pgTable("Tenant", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: tenantStatusEnum("status").notNull().default("ACTIVE"),
  // Pflichtangaben für Rechnungen (§ 14 UStG)
  legalName: text("legalName").notNull(),
  street: text("street").notNull(),
  zip: text("zip").notNull(),
  city: text("city").notNull(),
  country: text("country").notNull().default("DE"),
  taxNumber: text("taxNumber"),
  vatId: text("vatId"),
  iban: text("iban"),
  bic: text("bic"),
  smallBusiness: boolean("smallBusiness").notNull().default(false), // § 19 UStG
  invoicePrefix: text("invoicePrefix").notNull().default("RE"),
  defaultPaymentDays: integer("defaultPaymentDays").notNull().default(14),
  logoKey: text("logoKey"),
  invoiceFooter: text("invoiceFooter"),
  defaultPaymentMethod: paymentMethodEnum("defaultPaymentMethod").notNull().default("TRANSFER"),
  bankName: text("bankName"),
  invoiceEmail: text("invoiceEmail"),
  website: text("website"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable("User", {
  id: id(),
  tenantId: text("tenantId").references(() => tenants.id), // null nur bei SUPER_ADMIN
  email: text("email").notNull().unique(),
  passwordHash: text("passwordHash").notNull(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull(),
  isActive: boolean("isActive").notNull().default(true),
  canEnterCashExpense: boolean("canEnterCashExpense").notNull().default(false),
  canEnterOutlay: boolean("canEnterOutlay").notNull().default(true),
  canViewReports: boolean("canViewReports").notNull().default(false),
  canViewBank: boolean("canViewBank").notNull().default(false),
  lastLoginAt: timestamp("lastLoginAt", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("User_tenant_role_idx").on(t.tenantId, t.role)]);

export const sessions = pgTable("Session", {
  id: id(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("tokenHash").notNull().unique(), // nur Hash, nie den Token
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("Session_user_idx").on(t.userId)]);

// ---------------------------------------------------------------------
// MODUL A: KUNDEN & RECHNUNGEN
// ---------------------------------------------------------------------
export const contacts = pgTable("Contact", {
  id: id(),
  tenantId: text("tenantId").notNull().references(() => tenants.id),
  type: contactTypeEnum("type").notNull().default("CUSTOMER"),
  name: text("name").notNull(),
  email: text("email"),
  street: text("street"),
  zip: text("zip"),
  city: text("city"),
  country: text("country").notNull().default("DE"),
  vatId: text("vatId"),
  notes: text("notes"),
  archived: boolean("archived").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("Contact_tenant_name_idx").on(t.tenantId, t.name)]);

// Fortlaufende Nummer je Mandant und Jahr (atomar per UPSERT ... RETURNING)
export const invoiceSequences = pgTable("InvoiceSequence", {
  tenantId: text("tenantId").notNull().references(() => tenants.id),
  year: integer("year").notNull(),
  next: integer("next").notNull().default(1),
}, (t) => [primaryKey({ columns: [t.tenantId, t.year] })]);

export const invoices = pgTable("Invoice", {
  id: id(),
  tenantId: text("tenantId").notNull().references(() => tenants.id),
  contactId: text("contactId").notNull().references(() => contacts.id),
  number: text("number"), // "RE-2026-0001", erst bei DRAFT -> OPEN
  status: invoiceStatusEnum("status").notNull().default("DRAFT"),
  issueDate: timestamp("issueDate", { withTimezone: true }),
  serviceDate: timestamp("serviceDate", { withTimezone: true }),
  dueDate: timestamp("dueDate", { withTimezone: true }),
  paidAt: timestamp("paidAt", { withTimezone: true }),
  recipientSnapshot: jsonb("recipientSnapshot"),
  netCents: integer("netCents").notNull().default(0),
  vatCents: integer("vatCents").notNull().default(0),
  grossCents: integer("grossCents").notNull().default(0),
  notes: text("notes"),
  paymentMethod: paymentMethodEnum("paymentMethod").notNull().default("TRANSFER"),
  pdfKey: text("pdfKey"),
  cancelsInvoiceId: text("cancelsInvoiceId").unique().references((): AnyPgColumn => invoices.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("Invoice_tenant_number_key").on(t.tenantId, t.number),
  index("Invoice_tenant_status_due_idx").on(t.tenantId, t.status, t.dueDate),
  index("Invoice_tenant_contact_idx").on(t.tenantId, t.contactId),
]);

export const invoiceItems = pgTable("InvoiceItem", {
  id: id(),
  invoiceId: text("invoiceId").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unit: text("unit").notNull().default("Stk"),
  unitPriceCents: integer("unitPriceCents").notNull(), // netto
  vatRate: integer("vatRate").notNull(), // Basispunkte: 1900 = 19 %
  lineNetCents: integer("lineNetCents").notNull(),
  lineVatCents: integer("lineVatCents").notNull(),
}, (t) => [index("InvoiceItem_invoice_idx").on(t.invoiceId)]);

// ---------------------------------------------------------------------
// MODUL C: BELEGE
// ---------------------------------------------------------------------
export const receipts = pgTable("Receipt", {
  id: id(),
  tenantId: text("tenantId").notNull().references(() => tenants.id),
  employeeId: text("employeeId").notNull().references(() => users.id),
  amountCents: integer("amountCents").notNull(),
  vatRate: integer("vatRate"),
  merchant: text("merchant").notNull(),
  description: text("description"),
  receiptDate: timestamp("receiptDate", { withTimezone: true }).notNull(),
  fileKey: text("fileKey").notNull(),
  fileMime: text("fileMime").notNull(),
  fileSha256: text("fileSha256").notNull(),
  status: receiptStatusEnum("status").notNull().default("SUBMITTED"),
  reviewedById: text("reviewedById").references(() => users.id),
  reviewedAt: timestamp("reviewedAt", { withTimezone: true }),
  rejectReason: text("rejectReason"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("Receipt_tenant_sha_key").on(t.tenantId, t.fileSha256),
  index("Receipt_tenant_emp_date_idx").on(t.tenantId, t.employeeId, t.receiptDate),
  index("Receipt_tenant_status_idx").on(t.tenantId, t.status),
]);

// ---------------------------------------------------------------------
// MODUL D: ABSCHLÜSSE
// ---------------------------------------------------------------------
export const periodClosings = pgTable("PeriodClosing", {
  id: id(),
  tenantId: text("tenantId").notNull().references(() => tenants.id),
  periodType: periodTypeEnum("periodType").notNull(),
  periodStart: timestamp("periodStart", { withTimezone: true }).notNull(),
  periodEnd: timestamp("periodEnd", { withTimezone: true }).notNull(),
  totals: jsonb("totals").notNull(),
  closedById: text("closedById").notNull().references(() => users.id),
  closedAt: timestamp("closedAt", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("PeriodClosing_unique").on(t.tenantId, t.periodType, t.periodStart)]);

// ---------------------------------------------------------------------
// MODUL B + C: HAUPTBUCH
// Saldo Pool   = SUM(poolDeltaCents)   je Mandant
// Saldo Wallet = SUM(walletDeltaCents) je Mitarbeiter
// ---------------------------------------------------------------------
export const ledgerEntries = pgTable("LedgerEntry", {
  id: id(),
  tenantId: text("tenantId").notNull().references(() => tenants.id),
  type: ledgerTypeEnum("type").notNull(),
  poolDeltaCents: integer("poolDeltaCents").notNull().default(0),
  cashDeltaCents: integer("cashDeltaCents").notNull().default(0),
  bankDeltaCents: integer("bankDeltaCents").notNull().default(0),
  claimDeltaCents: integer("claimDeltaCents").notNull().default(0),
  partnerDeltaCents: integer("partnerDeltaCents").notNull().default(0),
  accountKind: accountKindEnum("accountKind"),
  walletDeltaCents: integer("walletDeltaCents").notNull().default(0),
  bookingDate: timestamp("bookingDate", { withTimezone: true }).notNull().defaultNow(),
  description: text("description"),
  employeeId: text("employeeId").references(() => users.id),
  createdById: text("createdById").notNull().references(() => users.id),
  // Herkunft – unique verhindert Doppelbuchung derselben Quelle
  invoiceId: text("invoiceId").unique().references(() => invoices.id),
  receiptId: text("receiptId").unique().references(() => receipts.id),
  reversalOfId: text("reversalOfId").unique().references((): AnyPgColumn => ledgerEntries.id),
  closingId: text("closingId").references(() => periodClosings.id),
  createdAt: createdAt(), // KEIN updatedAt: unveränderlich
}, (t) => [
  index("Ledger_tenant_date_idx").on(t.tenantId, t.bookingDate),
  index("Ledger_tenant_emp_date_idx").on(t.tenantId, t.employeeId, t.bookingDate),
  index("Ledger_tenant_type_idx").on(t.tenantId, t.type),
]);

export const auditLogs = pgTable("AuditLog", {
  id: id(),
  tenantId: text("tenantId").references(() => tenants.id),
  actorId: text("actorId"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entityId").notNull(),
  meta: jsonb("meta"),
  createdAt: createdAt(),
}, (t) => [
  index("Audit_tenant_date_idx").on(t.tenantId, t.createdAt),
  index("Audit_entity_idx").on(t.entity, t.entityId),
]);

export const employeeProfiles = pgTable("EmployeeProfile", {
  id: id(),
  tenantId: text("tenantId").notNull().references(() => tenants.id),
  userId: text("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  dateOfBirth: timestamp("dateOfBirth", { withTimezone: true }),
  nationality: text("nationality"),
  street: text("street"),
  zip: text("zip"),
  city: text("city"),
  taxId: text("taxId"),
  socialSecurityNumber: text("socialSecurityNumber"),
  taxClass: integer("taxClass").notNull().default(1),
  childAllowances: integer("childAllowances").notNull().default(0),
  churchTax: churchTaxEnum("churchTax").notNull().default("NONE"),
  healthInsuranceName: text("healthInsuranceName"),
  kvAdditionalBp: integer("kvAdditionalBp").notNull().default(250),
  iban: text("iban"),
  bic: text("bic"),
  jobTitle: text("jobTitle"),
  startDate: timestamp("startDate", { withTimezone: true }),
  weeklyHours: numeric("weeklyHours", { precision: 5, scale: 2 }),
  hourlyRateCents: integer("hourlyRateCents").notNull().default(0),
  hoursPerMonth: numeric("hoursPerMonth", { precision: 8, scale: 2 }),
  monthlyGrossCents: integer("monthlyGrossCents").notNull().default(0),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("EmployeeProfile_tenant_idx").on(t.tenantId)]);

export const hrDocuments = pgTable("HrDocument", {
  id: id(),
  tenantId: text("tenantId").notNull().references(() => tenants.id),
  employeeId: text("employeeId").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: hrDocKindEnum("kind").notNull().default("OTHER"),
  title: text("title").notNull(),
  fileKey: text("fileKey").notNull(),
  fileMime: text("fileMime").notNull(),
  notes: text("notes"),
  createdById: text("createdById").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("HrDocument_tenant_emp_idx").on(t.tenantId, t.employeeId)]);

export const payslips = pgTable("Payslip", {
  id: id(),
  tenantId: text("tenantId").notNull().references(() => tenants.id),
  employeeId: text("employeeId").notNull().references(() => users.id),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  grossCents: integer("grossCents").notNull(),
  hoursWorked: numeric("hoursWorked", { precision: 8, scale: 2 }),
  hourlyRateCents: integer("hourlyRateCents").notNull().default(0),
  taxClass: integer("taxClass").notNull(),
  childAllowances: integer("childAllowances").notNull().default(0),
  churchTax: churchTaxEnum("churchTax").notNull().default("NONE"),
  rvCents: integer("rvCents").notNull().default(0),
  avCents: integer("avCents").notNull().default(0),
  kvCents: integer("kvCents").notNull().default(0),
  pvCents: integer("pvCents").notNull().default(0),
  wageTaxCents: integer("wageTaxCents").notNull().default(0),
  soliCents: integer("soliCents").notNull().default(0),
  churchTaxCents: integer("churchTaxCents").notNull().default(0),
  netCents: integer("netCents").notNull(),
  pdfKey: text("pdfKey"),
  createdById: text("createdById").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("Payslip_emp_period_key").on(t.tenantId, t.employeeId, t.year, t.month),
]);

export const bankStatements = pgTable("BankStatement", {
  id: id(),
  tenantId: text("tenantId").notNull().references(() => tenants.id),
  periodMonth: text("periodMonth").notNull(),
  fileName: text("fileName").notNull(),
  fileMime: text("fileMime").notNull(),
  fileKey: text("fileKey").notNull(),
  createdById: text("createdById").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("BankStatement_tenant_month_idx").on(t.tenantId, t.periodMonth)]);

export const bankTransactions = pgTable("BankTransaction", {
  id: id(),
  tenantId: text("tenantId").notNull().references(() => tenants.id),
  statementId: text("statementId").notNull().references(() => bankStatements.id, { onDelete: "cascade" }),
  bookingDate: timestamp("bookingDate", { withTimezone: true }).notNull(),
  amountCents: integer("amountCents").notNull(),
  payee: text("payee"),
  purpose: text("purpose"),
  iban: text("iban"),
  status: reconcileStatusEnum("status").notNull().default("RED"),
  matchedInvoiceId: text("matchedInvoiceId").references(() => invoices.id),
  matchedReceiptId: text("matchedReceiptId").references(() => receipts.id),
  postedLedgerId: text("postedLedgerId").references(() => ledgerEntries.id),
  createdAt: createdAt(),
}, (t) => [index("BankTx_tenant_date_idx").on(t.tenantId, t.bookingDate)]);

export type Role = (typeof roleEnum.enumValues)[number];
export type LedgerType = (typeof ledgerTypeEnum.enumValues)[number];
export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];
export type AccountKind = (typeof accountKindEnum.enumValues)[number];
