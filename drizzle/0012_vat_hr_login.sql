-- MwSt. getrennt im Hauptbuch, Gesellschafter-Rolle, optionaler Login für Mitarbeiter
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "vatRate" integer;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "vatCents" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "vatMode" text;
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD COLUMN IF NOT EXISTS "partnerRole" text;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canLogin" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "fileSha256" text;
--> statement-breakpoint
ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "openingCents" integer;
--> statement-breakpoint
ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "closingCents" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "BankStatement_tenant_sha_idx" ON "BankStatement" ("tenantId", "fileSha256");
