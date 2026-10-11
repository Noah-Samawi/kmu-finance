ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'CASH_WITHDRAWAL';
--> statement-breakpoint
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'ACCOUNT_ADJUST';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "AccountKind" AS ENUM ('CASH', 'BANK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "HrDocKind" AS ENUM ('ID', 'CONTRACT', 'TIMESHEET', 'TAX', 'PAYSLIP', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "ReconcileStatus" AS ENUM ('GREEN', 'RED', 'CASH_WITHDRAWAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "ChurchTax" AS ENUM ('NONE', 'EIGHT', 'NINE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canEnterCashExpense" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "cashDeltaCents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "bankDeltaCents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "accountKind" "AccountKind";
--> statement-breakpoint
UPDATE "LedgerEntry" SET "cashDeltaCents" = "poolDeltaCents" WHERE "cashDeltaCents" = 0 AND "bankDeltaCents" = 0 AND "poolDeltaCents" <> 0;
--> statement-breakpoint
UPDATE "LedgerEntry" SET "accountKind" = 'CASH' WHERE "accountKind" IS NULL AND "poolDeltaCents" <> 0;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS ledger_nonzero;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_nonzero CHECK (
  "poolDeltaCents" <> 0 OR "walletDeltaCents" <> 0 OR "cashDeltaCents" <> 0 OR "bankDeltaCents" <> 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "EmployeeProfile" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "userId" text NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "dateOfBirth" timestamptz,
  "nationality" text,
  "street" text,
  "zip" text,
  "city" text,
  "taxId" text,
  "socialSecurityNumber" text,
  "taxClass" integer NOT NULL DEFAULT 1,
  "childAllowances" integer NOT NULL DEFAULT 0,
  "churchTax" "ChurchTax" NOT NULL DEFAULT 'NONE',
  "healthInsuranceName" text,
  "kvAdditionalBp" integer NOT NULL DEFAULT 250,
  "iban" text,
  "bic" text,
  "jobTitle" text,
  "startDate" timestamptz,
  "weeklyHours" numeric(5, 2),
  "monthlyGrossCents" integer NOT NULL DEFAULT 0,
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "EmployeeProfile_tenant_idx" ON "EmployeeProfile" ("tenantId");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "HrDocument" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "employeeId" text NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "kind" "HrDocKind" NOT NULL DEFAULT 'OTHER',
  "title" text NOT NULL,
  "fileKey" text NOT NULL,
  "fileMime" text NOT NULL,
  "notes" text,
  "createdById" text NOT NULL REFERENCES "User"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "HrDocument_tenant_emp_idx" ON "HrDocument" ("tenantId", "employeeId");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Payslip" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "employeeId" text NOT NULL REFERENCES "User"("id"),
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "grossCents" integer NOT NULL,
  "taxClass" integer NOT NULL,
  "childAllowances" integer NOT NULL DEFAULT 0,
  "churchTax" "ChurchTax" NOT NULL DEFAULT 'NONE',
  "rvCents" integer NOT NULL DEFAULT 0,
  "avCents" integer NOT NULL DEFAULT 0,
  "kvCents" integer NOT NULL DEFAULT 0,
  "pvCents" integer NOT NULL DEFAULT 0,
  "wageTaxCents" integer NOT NULL DEFAULT 0,
  "soliCents" integer NOT NULL DEFAULT 0,
  "churchTaxCents" integer NOT NULL DEFAULT 0,
  "netCents" integer NOT NULL,
  "pdfKey" text,
  "createdById" text NOT NULL REFERENCES "User"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Payslip_emp_period_key" ON "Payslip" ("tenantId", "employeeId", "year", "month");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "BankStatement" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "periodMonth" text NOT NULL,
  "fileName" text NOT NULL,
  "fileMime" text NOT NULL,
  "fileKey" text NOT NULL,
  "createdById" text NOT NULL REFERENCES "User"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "BankStatement_tenant_month_idx" ON "BankStatement" ("tenantId", "periodMonth");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "BankTransaction" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "statementId" text NOT NULL REFERENCES "BankStatement"("id") ON DELETE CASCADE,
  "bookingDate" timestamptz NOT NULL,
  "amountCents" integer NOT NULL,
  "payee" text,
  "purpose" text,
  "iban" text,
  "status" "ReconcileStatus" NOT NULL DEFAULT 'RED',
  "matchedInvoiceId" text REFERENCES "Invoice"("id"),
  "matchedReceiptId" text REFERENCES "Receipt"("id"),
  "postedLedgerId" text REFERENCES "LedgerEntry"("id"),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "BankTx_tenant_date_idx" ON "BankTransaction" ("tenantId", "bookingDate");
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['EmployeeProfile','HrDocument','Payslip','BankStatement','BankTransaction'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("tenantId" = app_tenant() OR app_role() = ''SUPER_ADMIN'')
         WITH CHECK ("tenantId" = app_tenant())', t);
  END LOOP;
END $$;
--> statement-breakpoint
DROP POLICY IF EXISTS employee_own_hr_docs ON "HrDocument";
--> statement-breakpoint
CREATE POLICY employee_own_hr_docs ON "HrDocument" AS RESTRICTIVE
  USING (app_role() <> 'EMPLOYEE' OR "employeeId" = app_user());
--> statement-breakpoint
DROP POLICY IF EXISTS employee_own_payslips ON "Payslip";
--> statement-breakpoint
CREATE POLICY employee_own_payslips ON "Payslip" AS RESTRICTIVE
  USING (app_role() <> 'EMPLOYEE' OR "employeeId" = app_user());
--> statement-breakpoint
DROP POLICY IF EXISTS employee_own_profile ON "EmployeeProfile";
--> statement-breakpoint
CREATE POLICY employee_own_profile ON "EmployeeProfile" AS RESTRICTIVE
  USING (app_role() <> 'EMPLOYEE' OR "userId" = app_user());
--> statement-breakpoint
DROP POLICY IF EXISTS employee_no_bank ON "BankStatement";
--> statement-breakpoint
CREATE POLICY employee_no_bank ON "BankStatement" AS RESTRICTIVE
  USING (app_role() <> 'EMPLOYEE');
--> statement-breakpoint
DROP POLICY IF EXISTS employee_no_bank_tx ON "BankTransaction";
--> statement-breakpoint
CREATE POLICY employee_no_bank_tx ON "BankTransaction" AS RESTRICTIVE
  USING (app_role() <> 'EMPLOYEE');
--> statement-breakpoint
CREATE OR REPLACE VIEW cash_balance WITH (security_invoker = true) AS
  SELECT "tenantId", SUM("cashDeltaCents")::bigint AS balance_cents
  FROM "LedgerEntry" GROUP BY "tenantId";
--> statement-breakpoint
CREATE OR REPLACE VIEW bank_balance WITH (security_invoker = true) AS
  SELECT "tenantId", SUM("bankDeltaCents")::bigint AS balance_cents
  FROM "LedgerEntry" GROUP BY "tenantId";
--> statement-breakpoint
GRANT SELECT ON cash_balance, bank_balance TO app_user_role;
