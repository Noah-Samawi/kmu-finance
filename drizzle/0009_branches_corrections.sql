-- Filialen/Standorte je Firma, Filial-Zuordnung von Buchungen und Uploads,
-- Löschen/Ändern von Buchungen als protokollierte Korrektur (Storno + ggf. Ersatzbuchung, nie physisch gelöscht),
-- Kontoauszug: Abgleich mit vorhandenen Hauptbuchzeilen und automatische Verbuchung.
CREATE TABLE IF NOT EXISTS "Branch" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "name" text NOT NULL,
  "city" text,
  "isActive" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "Branch_tenant_name_key" ON "Branch" ("tenantId", lower("name"));
--> statement-breakpoint
ALTER TABLE "Branch" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "Branch" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "Branch";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "Branch"
  USING ("tenantId" = app_tenant() OR app_role() = 'SUPER_ADMIN')
  WITH CHECK ("tenantId" = app_tenant());
--> statement-breakpoint
REVOKE DELETE ON "Branch" FROM app_user_role;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "branchId" text REFERENCES "Branch"("id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Ledger_tenant_branch_idx" ON "LedgerEntry" ("tenantId", "branchId", "bookingDate") WHERE "branchId" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "branchId" text REFERENCES "Branch"("id");
--> statement-breakpoint
ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "branchId" text REFERENCES "Branch"("id");
--> statement-breakpoint
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "matchedLedgerId" text REFERENCES "LedgerEntry"("id");
--> statement-breakpoint
ALTER TYPE "ReconcileStatus" ADD VALUE IF NOT EXISTS 'BOOKED';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "LedgerCorrection" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "kind" text NOT NULL CHECK ("kind" IN ('REMOVE', 'EDIT')),
  "originalId" text NOT NULL UNIQUE REFERENCES "LedgerEntry"("id"),
  "reversalId" text NOT NULL UNIQUE REFERENCES "LedgerEntry"("id"),
  "replacementId" text UNIQUE REFERENCES "LedgerEntry"("id"),
  "previousAmountCents" integer NOT NULL,
  "previousDescription" text,
  "reason" text NOT NULL,
  "createdById" text NOT NULL REFERENCES "User"("id"),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "LedgerCorrection_tenant_idx" ON "LedgerCorrection" ("tenantId", "createdAt");
--> statement-breakpoint
ALTER TABLE "LedgerCorrection" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "LedgerCorrection" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "LedgerCorrection";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "LedgerCorrection"
  USING ("tenantId" = app_tenant() OR app_role() = 'SUPER_ADMIN')
  WITH CHECK ("tenantId" = app_tenant());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "LedgerCorrection" FROM app_user_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "Branch" TO app_user_role;
--> statement-breakpoint
GRANT SELECT, INSERT ON "LedgerCorrection" TO app_user_role;
