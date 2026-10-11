ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "bankName" text;
--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "invoiceEmail" text;
--> statement-breakpoint
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "website" text;
