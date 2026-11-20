-- Phase 4: companyId NOT NULL auf Kerntabellen + Company-Scope in Session-Vars/RLS-Helfer.

-- Fehlende companyIds absichern (sollte nach 0014 leer sein)
UPDATE "Branch" b SET "companyId" = c."id" FROM "Company" c
WHERE c."tenantId" = b."tenantId" AND b."companyId" IS NULL;
--> statement-breakpoint
UPDATE "LedgerEntry" x SET "companyId" = c."id" FROM "Company" c
WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "Contact" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "Invoice" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "Receipt" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "BankStatement" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "BankTransaction" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "IncomingBill" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "PartnerBooking" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "EmployeeProfile" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "HrDocument" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "Payslip" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "LedgerAttachment" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "LedgerCorrection" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "PartnerOutlayRefund" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "PeriodClosing" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint

ALTER TABLE "Branch" ALTER COLUMN "companyId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ALTER COLUMN "companyId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "Contact" ALTER COLUMN "companyId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "Invoice" ALTER COLUMN "companyId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "Receipt" ALTER COLUMN "companyId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "BankStatement" ALTER COLUMN "companyId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "BankTransaction" ALTER COLUMN "companyId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "IncomingBill" ALTER COLUMN "companyId" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "PartnerBooking" ALTER COLUMN "companyId" SET NOT NULL;
--> statement-breakpoint

-- Session-Helfer für Company-Scope
CREATE OR REPLACE FUNCTION app_company() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.company_id', true), '') $$;
--> statement-breakpoint

-- Company-Admin / Employee: zusätzlich auf companyId einschränken (RESTRICTIVE)
-- TENANT_OWNER und SUPER_ADMIN / ADMIN sehen alle Companies des Tenants
DROP POLICY IF EXISTS company_scope_ledger ON "LedgerEntry";
--> statement-breakpoint
CREATE POLICY company_scope_ledger ON "LedgerEntry" AS RESTRICTIVE
  USING (
    app_role() IN ('SUPER_ADMIN', 'TENANT_OWNER', 'ADMIN')
    OR app_company() IS NULL
    OR "companyId" = app_company()
  );
--> statement-breakpoint

DROP POLICY IF EXISTS company_scope_receipt ON "Receipt";
--> statement-breakpoint
CREATE POLICY company_scope_receipt ON "Receipt" AS RESTRICTIVE
  USING (
    app_role() IN ('SUPER_ADMIN', 'TENANT_OWNER', 'ADMIN')
    OR app_company() IS NULL
    OR "companyId" = app_company()
  );
--> statement-breakpoint

DROP POLICY IF EXISTS company_scope_invoice ON "Invoice";
--> statement-breakpoint
CREATE POLICY company_scope_invoice ON "Invoice" AS RESTRICTIVE
  USING (
    app_role() IN ('SUPER_ADMIN', 'TENANT_OWNER', 'ADMIN')
    OR app_company() IS NULL
    OR "companyId" = app_company()
  );
--> statement-breakpoint

DROP POLICY IF EXISTS company_scope_branch ON "Branch";
--> statement-breakpoint
CREATE POLICY company_scope_branch ON "Branch" AS RESTRICTIVE
  USING (
    app_role() IN ('SUPER_ADMIN', 'TENANT_OWNER', 'ADMIN')
    OR app_company() IS NULL
    OR "companyId" = app_company()
  );
--> statement-breakpoint

-- purge_tenant: Company/Membership/PasswordReset mitlöschen
CREATE OR REPLACE FUNCTION purge_tenant(p_tenant text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_role() IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'only SUPER_ADMIN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Tenant" WHERE id = p_tenant) THEN
    RAISE EXCEPTION 'tenant not found';
  END IF;

  DELETE FROM "BankTransaction" WHERE "tenantId" = p_tenant;
  DELETE FROM "BankStatement" WHERE "tenantId" = p_tenant;
  DELETE FROM "PartnerOutlayRefund" WHERE "tenantId" = p_tenant;
  DELETE FROM "PartnerBooking" WHERE "tenantId" = p_tenant;
  DELETE FROM "LedgerCorrection" WHERE "tenantId" = p_tenant;
  DELETE FROM "LedgerAttachment" WHERE "tenantId" = p_tenant;
  DELETE FROM "IncomingBill" WHERE "tenantId" = p_tenant;
  DELETE FROM "Payslip" WHERE "tenantId" = p_tenant;
  DELETE FROM "HrDocument" WHERE "tenantId" = p_tenant;
  DELETE FROM "EmployeeProfile" WHERE "tenantId" = p_tenant;
  DELETE FROM "LedgerEntry" WHERE "tenantId" = p_tenant;
  DELETE FROM "PeriodClosing" WHERE "tenantId" = p_tenant;
  DELETE FROM "Receipt" WHERE "tenantId" = p_tenant;
  DELETE FROM "InvoiceItem" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "tenantId" = p_tenant);
  DELETE FROM "Invoice" WHERE "tenantId" = p_tenant;
  DELETE FROM "InvoiceSequence" WHERE "tenantId" = p_tenant;
  DELETE FROM "Contact" WHERE "tenantId" = p_tenant;
  DELETE FROM "Membership" WHERE "tenantId" = p_tenant;
  DELETE FROM "Branch" WHERE "tenantId" = p_tenant;
  DELETE FROM "Company" WHERE "tenantId" = p_tenant;
  DELETE FROM "AuditLog" WHERE "tenantId" = p_tenant;
  DELETE FROM "PasswordResetToken" WHERE "userId" IN (SELECT id FROM "User" WHERE "tenantId" = p_tenant);
  DELETE FROM "User" WHERE "tenantId" = p_tenant;
  DELETE FROM "Tenant" WHERE id = p_tenant;
END;
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION purge_tenant(text) TO app_user_role;
