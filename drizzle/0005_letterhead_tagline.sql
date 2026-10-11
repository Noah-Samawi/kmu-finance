ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "invoiceTagline" text;
--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "ownerName" text;
