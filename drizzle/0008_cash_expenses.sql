-- Kasse & Bank: Betriebsausgaben mit Kategorie, kombinierte Tageseinnahme (Kasse + Bank als eine Bewegung),
-- Einkäufe von Gesellschaftern für die Firma (vom Kapitalkonto oder aus dem Budget) und Belege zu Hauptbuchzeilen.
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'EXPENSE';
--> statement-breakpoint
ALTER TYPE "PartnerBookingKind" ADD VALUE IF NOT EXISTS 'PURCHASE_CAPITAL';
--> statement-breakpoint
ALTER TYPE "PartnerBookingKind" ADD VALUE IF NOT EXISTS 'PURCHASE_BUDGET';
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "category" text;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "batchId" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Ledger_tenant_batch_idx" ON "LedgerEntry" ("tenantId", "batchId") WHERE "batchId" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "LedgerAttachment" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "ledgerEntryId" text NOT NULL UNIQUE REFERENCES "LedgerEntry"("id"),
  "fileKey" text NOT NULL,
  "mime" text NOT NULL,
  "name" text NOT NULL,
  "createdById" text NOT NULL REFERENCES "User"("id"),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "LedgerAttachment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "LedgerAttachment" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "LedgerAttachment";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "LedgerAttachment"
  USING ("tenantId" = app_tenant() OR app_role() = 'SUPER_ADMIN')
  WITH CHECK ("tenantId" = app_tenant());
--> statement-breakpoint
DROP POLICY IF EXISTS employee_own_attachment ON "LedgerAttachment";
--> statement-breakpoint
CREATE POLICY employee_own_attachment ON "LedgerAttachment" AS RESTRICTIVE
  USING (app_role() <> 'EMPLOYEE' OR EXISTS (
    SELECT 1 FROM "LedgerEntry" l WHERE l."id" = "ledgerEntryId" AND l."employeeId" = app_user()
  ));
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "LedgerAttachment" FROM app_user_role;
