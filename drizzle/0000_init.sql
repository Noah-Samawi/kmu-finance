CREATE TYPE "public"."ContactType" AS ENUM('CUSTOMER', 'SUPPLIER', 'BOTH');--> statement-breakpoint
CREATE TYPE "public"."InvoiceStatus" AS ENUM('DRAFT', 'OPEN', 'PAID', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."LedgerType" AS ENUM('INCOME_INVOICE', 'INCOME_MANUAL', 'ALLOCATION', 'RECEIPT', 'ADJUSTMENT', 'RETURN', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."PeriodType" AS ENUM('DAY', 'MONTH');--> statement-breakpoint
CREATE TYPE "public"."ReceiptStatus" AS ENUM('SUBMITTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."Role" AS ENUM('SUPER_ADMIN', 'ADMIN', 'EMPLOYEE');--> statement-breakpoint
CREATE TYPE "public"."TenantStatus" AS ENUM('ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "AuditLog" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text,
	"actorId" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entityId" text NOT NULL,
	"meta" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Contact" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"type" "ContactType" DEFAULT 'CUSTOMER' NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"street" text,
	"zip" text,
	"city" text,
	"country" text DEFAULT 'DE' NOT NULL,
	"vatId" text,
	"notes" text,
	"archived" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "InvoiceItem" (
	"id" text PRIMARY KEY NOT NULL,
	"invoiceId" text NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" text DEFAULT 'Stk' NOT NULL,
	"unitPriceCents" integer NOT NULL,
	"vatRate" integer NOT NULL,
	"lineNetCents" integer NOT NULL,
	"lineVatCents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "InvoiceSequence" (
	"tenantId" text NOT NULL,
	"year" integer NOT NULL,
	"next" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "InvoiceSequence_tenantId_year_pk" PRIMARY KEY("tenantId","year")
);
--> statement-breakpoint
CREATE TABLE "Invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"contactId" text NOT NULL,
	"number" text,
	"status" "InvoiceStatus" DEFAULT 'DRAFT' NOT NULL,
	"issueDate" timestamp with time zone,
	"serviceDate" timestamp with time zone,
	"dueDate" timestamp with time zone,
	"paidAt" timestamp with time zone,
	"recipientSnapshot" jsonb,
	"netCents" integer DEFAULT 0 NOT NULL,
	"vatCents" integer DEFAULT 0 NOT NULL,
	"grossCents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"pdfKey" text,
	"cancelsInvoiceId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Invoice_cancelsInvoiceId_unique" UNIQUE("cancelsInvoiceId")
);
--> statement-breakpoint
CREATE TABLE "LedgerEntry" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"type" "LedgerType" NOT NULL,
	"poolDeltaCents" integer DEFAULT 0 NOT NULL,
	"walletDeltaCents" integer DEFAULT 0 NOT NULL,
	"bookingDate" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text,
	"employeeId" text,
	"createdById" text NOT NULL,
	"invoiceId" text,
	"receiptId" text,
	"reversalOfId" text,
	"closingId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "LedgerEntry_invoiceId_unique" UNIQUE("invoiceId"),
	CONSTRAINT "LedgerEntry_receiptId_unique" UNIQUE("receiptId"),
	CONSTRAINT "LedgerEntry_reversalOfId_unique" UNIQUE("reversalOfId")
);
--> statement-breakpoint
CREATE TABLE "PeriodClosing" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"periodType" "PeriodType" NOT NULL,
	"periodStart" timestamp with time zone NOT NULL,
	"periodEnd" timestamp with time zone NOT NULL,
	"totals" jsonb NOT NULL,
	"closedById" text NOT NULL,
	"closedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Receipt" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text NOT NULL,
	"employeeId" text NOT NULL,
	"amountCents" integer NOT NULL,
	"vatRate" integer,
	"merchant" text NOT NULL,
	"description" text,
	"receiptDate" timestamp with time zone NOT NULL,
	"fileKey" text NOT NULL,
	"fileMime" text NOT NULL,
	"fileSha256" text NOT NULL,
	"status" "ReceiptStatus" DEFAULT 'SUBMITTED' NOT NULL,
	"reviewedById" text,
	"reviewedAt" timestamp with time zone,
	"rejectReason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Session" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Session_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "Tenant" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "TenantStatus" DEFAULT 'ACTIVE' NOT NULL,
	"legalName" text NOT NULL,
	"street" text NOT NULL,
	"zip" text NOT NULL,
	"city" text NOT NULL,
	"country" text DEFAULT 'DE' NOT NULL,
	"taxNumber" text,
	"vatId" text,
	"iban" text,
	"bic" text,
	"smallBusiness" boolean DEFAULT false NOT NULL,
	"invoicePrefix" text DEFAULT 'RE' NOT NULL,
	"defaultPaymentDays" integer DEFAULT 14 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "Tenant_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" text PRIMARY KEY NOT NULL,
	"tenantId" text,
	"email" text NOT NULL,
	"passwordHash" text NOT NULL,
	"name" text NOT NULL,
	"role" "Role" NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"lastLoginAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "User_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_Invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "InvoiceSequence" ADD CONSTRAINT "InvoiceSequence_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contactId_Contact_id_fk" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cancelsInvoiceId_Invoice_id_fk" FOREIGN KEY ("cancelsInvoiceId") REFERENCES "public"."Invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_employeeId_User_id_fk" FOREIGN KEY ("employeeId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_createdById_User_id_fk" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_invoiceId_Invoice_id_fk" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_receiptId_Receipt_id_fk" FOREIGN KEY ("receiptId") REFERENCES "public"."Receipt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversalOfId_LedgerEntry_id_fk" FOREIGN KEY ("reversalOfId") REFERENCES "public"."LedgerEntry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_closingId_PeriodClosing_id_fk" FOREIGN KEY ("closingId") REFERENCES "public"."PeriodClosing"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PeriodClosing" ADD CONSTRAINT "PeriodClosing_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PeriodClosing" ADD CONSTRAINT "PeriodClosing_closedById_User_id_fk" FOREIGN KEY ("closedById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_employeeId_User_id_fk" FOREIGN KEY ("employeeId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_reviewedById_User_id_fk" FOREIGN KEY ("reviewedById") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Audit_tenant_date_idx" ON "AuditLog" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE INDEX "Audit_entity_idx" ON "AuditLog" USING btree ("entity","entityId");--> statement-breakpoint
CREATE INDEX "Contact_tenant_name_idx" ON "Contact" USING btree ("tenantId","name");--> statement-breakpoint
CREATE INDEX "InvoiceItem_invoice_idx" ON "InvoiceItem" USING btree ("invoiceId");--> statement-breakpoint
CREATE UNIQUE INDEX "Invoice_tenant_number_key" ON "Invoice" USING btree ("tenantId","number");--> statement-breakpoint
CREATE INDEX "Invoice_tenant_status_due_idx" ON "Invoice" USING btree ("tenantId","status","dueDate");--> statement-breakpoint
CREATE INDEX "Invoice_tenant_contact_idx" ON "Invoice" USING btree ("tenantId","contactId");--> statement-breakpoint
CREATE INDEX "Ledger_tenant_date_idx" ON "LedgerEntry" USING btree ("tenantId","bookingDate");--> statement-breakpoint
CREATE INDEX "Ledger_tenant_emp_date_idx" ON "LedgerEntry" USING btree ("tenantId","employeeId","bookingDate");--> statement-breakpoint
CREATE INDEX "Ledger_tenant_type_idx" ON "LedgerEntry" USING btree ("tenantId","type");--> statement-breakpoint
CREATE UNIQUE INDEX "PeriodClosing_unique" ON "PeriodClosing" USING btree ("tenantId","periodType","periodStart");--> statement-breakpoint
CREATE UNIQUE INDEX "Receipt_tenant_sha_key" ON "Receipt" USING btree ("tenantId","fileSha256");--> statement-breakpoint
CREATE INDEX "Receipt_tenant_emp_date_idx" ON "Receipt" USING btree ("tenantId","employeeId","receiptDate");--> statement-breakpoint
CREATE INDEX "Receipt_tenant_status_idx" ON "Receipt" USING btree ("tenantId","status");--> statement-breakpoint
CREATE INDEX "Session_user_idx" ON "Session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "User_tenant_role_idx" ON "User" USING btree ("tenantId","role");