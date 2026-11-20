-- Phase 1: Additive – Company, Membership, PENDING, TOTP, Passwort-Reset.
-- Bestehende Spalten bleiben; companyId zunächst NULL (Backfill in 0014).

-- Rollen erweitern (Tenant-Owner / Company-Admin). ADMIN bleibt vorerst für Kompatibilität.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'TENANT_OWNER';
--> statement-breakpoint
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'COMPANY_ADMIN';
--> statement-breakpoint

-- Tenant-Status: PENDING (Warte auf Freigabe), BLOCKED (gesperrt)
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'PENDING';
--> statement-breakpoint
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';
--> statement-breakpoint

-- Company = rechtliche Firma unter einem Tenant-Konto
CREATE TABLE IF NOT EXISTS "Company" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "legalName" text NOT NULL,
  "street" text NOT NULL,
  "zip" text NOT NULL,
  "city" text NOT NULL,
  "country" text NOT NULL DEFAULT 'DE',
  "taxNumber" text,
  "vatId" text,
  "iban" text,
  "bic" text,
  "smallBusiness" boolean NOT NULL DEFAULT false,
  "invoicePrefix" text NOT NULL DEFAULT 'RE',
  "defaultPaymentDays" integer NOT NULL DEFAULT 14,
  "logoKey" text,
  "invoiceFooter" text,
  "defaultPaymentMethod" "PaymentMethod" NOT NULL DEFAULT 'TRANSFER',
  "bankName" text,
  "invoiceEmail" text,
  "website" text,
  "invoiceTagline" text,
  "ownerName" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Company_tenant_slug_key" ON "Company" ("tenantId", "slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Company_tenant_idx" ON "Company" ("tenantId");
--> statement-breakpoint

-- Mitgliedschaft: User ↔ Tenant/Company/Branch mit Rolle
CREATE TABLE IF NOT EXISTS "Membership" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "companyId" text REFERENCES "Company"("id") ON DELETE CASCADE,
  "branchId" text REFERENCES "Branch"("id") ON DELETE SET NULL,
  "role" "Role" NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Membership_tenant_user_idx" ON "Membership" ("tenantId", "userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Membership_company_idx" ON "Membership" ("companyId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Membership_user_tenant_role_idx"
  ON "Membership" ("userId", "tenantId", "role");
--> statement-breakpoint

-- TOTP / 2FA am User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpSecret" text;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpEnabled" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpVerifiedAt" timestamptz;
--> statement-breakpoint

-- Passwort-Reset-Token
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "tokenHash" text NOT NULL UNIQUE,
  "expiresAt" timestamptz NOT NULL,
  "usedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PasswordResetToken_user_idx" ON "PasswordResetToken" ("userId");
--> statement-breakpoint

-- companyId an Branch + Fachdaten (nullable bis Backfill)
ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "InvoiceSequence" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "PeriodClosing" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "LedgerAttachment" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "LedgerCorrection" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "IncomingBill" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "PartnerBooking" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "PartnerOutlayRefund" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "HrDocument" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "companyId" text REFERENCES "Company"("id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "Branch_company_idx" ON "Branch" ("companyId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Ledger_company_date_idx" ON "LedgerEntry" ("companyId", "bookingDate");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Invoice_company_idx" ON "Invoice" ("companyId");
--> statement-breakpoint

-- RLS für neue Tabellen (tenant-level, wie bisher)
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Company" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "Company";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "Company"
  USING ("tenantId" = app_tenant() OR app_role() = 'SUPER_ADMIN')
  WITH CHECK ("tenantId" = app_tenant());
--> statement-breakpoint

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "Membership";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "Membership"
  USING ("tenantId" = app_tenant() OR app_role() = 'SUPER_ADMIN')
  WITH CHECK ("tenantId" = app_tenant());
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "Company" TO app_user_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "Membership" TO app_user_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "PasswordResetToken" TO app_user_role;
