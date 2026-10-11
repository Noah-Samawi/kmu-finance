ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PARTNER';
--> statement-breakpoint
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_OUTLAY';
--> statement-breakpoint
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'OUTLAY_REPAY';
--> statement-breakpoint
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'PARTNER_DEPOSIT';
--> statement-breakpoint
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'PARTNER_DRAW';
--> statement-breakpoint
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'PARTNER_PROFIT';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "PaymentMethod" AS ENUM ('TRANSFER', 'CASH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "logoKey" text;
--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "invoiceFooter" text;
--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "defaultPaymentMethod" "PaymentMethod" NOT NULL DEFAULT 'TRANSFER';
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canEnterOutlay" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canViewReports" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canViewBank" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'TRANSFER';
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "claimDeltaCents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "partnerDeltaCents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "hourlyRateCents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "EmployeeProfile" ADD COLUMN IF NOT EXISTS "hoursPerMonth" numeric(8, 2);
--> statement-breakpoint
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "hoursWorked" numeric(8, 2);
--> statement-breakpoint
ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "hourlyRateCents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS ledger_nonzero;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_nonzero CHECK (
  "poolDeltaCents" <> 0 OR "walletDeltaCents" <> 0 OR "cashDeltaCents" <> 0 OR "bankDeltaCents" <> 0
  OR "claimDeltaCents" <> 0 OR "partnerDeltaCents" <> 0
);
--> statement-breakpoint
ALTER TABLE "LedgerEntry" DROP CONSTRAINT IF EXISTS ledger_wallet_needs_employee;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_wallet_needs_employee
  CHECK (("walletDeltaCents" = 0 AND "claimDeltaCents" = 0 AND "partnerDeltaCents" = 0) OR "employeeId" IS NOT NULL);
