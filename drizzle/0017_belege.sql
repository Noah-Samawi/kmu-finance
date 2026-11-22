-- Firmen-Belege (DATEV-ähnlich): Posteingang → Belegablage / Papierkorb
CREATE TYPE "BelegStatus" AS ENUM ('INBOX', 'FILED', 'TRASH');
--> statement-breakpoint
CREATE TYPE "BelegDocType" AS ENUM ('CASH', 'INCOMING_INVOICE', 'OUTGOING_INVOICE', 'OTHER');
--> statement-breakpoint
CREATE TYPE "BelegOcrStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Beleg" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "companyId" text NOT NULL REFERENCES "Company"("id"),
  "status" "BelegStatus" NOT NULL DEFAULT 'INBOX',
  "docType" "BelegDocType" NOT NULL DEFAULT 'OTHER',
  "branchId" text REFERENCES "Branch"("id"),
  "direction" text,
  "accountKind" "AccountKind",
  "amountCents" integer,
  "vatRate" integer,
  "vatCents" integer DEFAULT 0 NOT NULL,
  "vatMode" text DEFAULT 'GROSS',
  "merchant" text,
  "description" text,
  "receiptNumber" text,
  "category" text,
  "bookingDate" timestamp with time zone,
  "fileKey" text NOT NULL,
  "fileMime" text NOT NULL,
  "fileName" text,
  "fileSha256" text NOT NULL,
  "ocrStatus" "BelegOcrStatus" NOT NULL DEFAULT 'PENDING',
  "ocrJson" jsonb,
  "lines" jsonb,
  "ledgerEntryId" text UNIQUE REFERENCES "LedgerEntry"("id"),
  "batchId" text,
  "createdById" text NOT NULL REFERENCES "User"("id"),
  "trashedAt" timestamp with time zone,
  "filedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "Beleg_direction_check" CHECK ("direction" IS NULL OR "direction" IN ('EXPENSE', 'INCOME')),
  CONSTRAINT "Beleg_vatMode_check" CHECK ("vatMode" IS NULL OR "vatMode" IN ('GROSS', 'NET'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Beleg_tenant_status_idx" ON "Beleg" ("tenantId", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Beleg_tenant_date_idx" ON "Beleg" ("tenantId", "bookingDate");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Beleg_tenant_branch_idx" ON "Beleg" ("tenantId", "branchId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Beleg_tenant_sha_key" ON "Beleg" ("tenantId", "fileSha256")
  WHERE "status" <> 'TRASH';
--> statement-breakpoint
ALTER TABLE "Beleg" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Beleg" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "Beleg";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "Beleg"
  USING ("tenantId" = app_tenant() OR app_role() = 'SUPER_ADMIN')
  WITH CHECK ("tenantId" = app_tenant());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "Beleg" TO app_user_role;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kmu_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Beleg" TO kmu_app;
  END IF;
END $$;
