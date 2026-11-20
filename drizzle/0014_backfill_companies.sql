-- Phase 2: Bestehende Tenants → je 1 Company; Fachdaten + Memberships backfüllen.
-- Idempotent: nur Zeilen ohne companyId / fehlende Membership.

-- 1) Company aus Tenant-Stammdaten (1:1)
INSERT INTO "Company" (
  "id", "tenantId", "name", "slug", "isActive",
  "legalName", "street", "zip", "city", "country",
  "taxNumber", "vatId", "iban", "bic", "smallBusiness",
  "invoicePrefix", "defaultPaymentDays", "logoKey", "invoiceFooter",
  "defaultPaymentMethod", "bankName", "invoiceEmail", "website",
  "invoiceTagline", "ownerName", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  t."id",
  t."name",
  t."slug",
  true,
  t."legalName", t."street", t."zip", t."city", t."country",
  t."taxNumber", t."vatId", t."iban", t."bic", t."smallBusiness",
  t."invoicePrefix", t."defaultPaymentDays", t."logoKey", t."invoiceFooter",
  t."defaultPaymentMethod", t."bankName", t."invoiceEmail", t."website",
  t."invoiceTagline", t."ownerName", t."createdAt", now()
FROM "Tenant" t
WHERE NOT EXISTS (
  SELECT 1 FROM "Company" c WHERE c."tenantId" = t."id"
);
--> statement-breakpoint

-- 2) Branch.companyId
UPDATE "Branch" b
SET "companyId" = c."id"
FROM "Company" c
WHERE c."tenantId" = b."tenantId" AND b."companyId" IS NULL;
--> statement-breakpoint

-- 3) Fachtabellen: companyId aus Tenant (eine Company je Tenant)
UPDATE "Contact" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "Invoice" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "InvoiceSequence" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "Receipt" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "PeriodClosing" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "LedgerEntry" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "LedgerAttachment" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "LedgerCorrection" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "IncomingBill" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "PartnerBooking" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "PartnerOutlayRefund" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "EmployeeProfile" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "HrDocument" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "Payslip" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "BankStatement" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint
UPDATE "BankTransaction" x SET "companyId" = c."id" FROM "Company" c WHERE c."tenantId" = x."tenantId" AND x."companyId" IS NULL;
--> statement-breakpoint

-- 4) Memberships: erster ADMIN → TENANT_OWNER (ohne company-Scope = ganzes Konto)
INSERT INTO "Membership" ("id", "tenantId", "userId", "companyId", "branchId", "role", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."tenantId", u."id", NULL, NULL, 'TENANT_OWNER'::"Role", u."isActive", now(), now()
FROM "User" u
WHERE u."role" = 'ADMIN' AND u."tenantId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."userId" = u."id" AND m."tenantId" = u."tenantId" AND m."role" = 'TENANT_OWNER'
  );
--> statement-breakpoint

-- Auch User.role auf TENANT_OWNER heben (ADMIN bleibt im Enum für Übergang)
UPDATE "User" u
SET "role" = 'TENANT_OWNER'
WHERE u."role" = 'ADMIN' AND u."tenantId" IS NOT NULL;
--> statement-breakpoint

-- EMPLOYEE / PARTNER → Membership auf der Company des Tenants
INSERT INTO "Membership" ("id", "tenantId", "userId", "companyId", "branchId", "role", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."tenantId", u."id", c."id", NULL, u."role", u."isActive", now(), now()
FROM "User" u
JOIN "Company" c ON c."tenantId" = u."tenantId"
WHERE u."role" IN ('EMPLOYEE', 'PARTNER') AND u."tenantId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."userId" = u."id" AND m."tenantId" = u."tenantId" AND m."companyId" = c."id" AND m."role" = u."role"
  );
--> statement-breakpoint

-- Kontrolle (nur Info – Migration bricht nicht)
DO $$
DECLARE
  missing_ledger int;
  missing_branch int;
BEGIN
  SELECT count(*) INTO missing_ledger FROM "LedgerEntry" WHERE "companyId" IS NULL;
  SELECT count(*) INTO missing_branch FROM "Branch" WHERE "companyId" IS NULL;
  RAISE NOTICE 'Backfill check: LedgerEntry without companyId=% Branch without companyId=%', missing_ledger, missing_branch;
END $$;
