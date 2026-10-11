ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'PARTNER_OUTLAY';
--> statement-breakpoint
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'PARTNER_OUTLAY_REFUND';
--> statement-breakpoint
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'PARTNER_EXPENSE';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "FundingSource" AS ENUM ('PRIVATE', 'BANK', 'CASH');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "PartnerBookingKind" AS ENUM (
    'DEPOSIT', 'OUTLAY', 'DRAW', 'PROFIT', 'BUDGET', 'BUDGET_RETURN', 'BUDGET_SETTLED', 'OUTLAY_REFUND'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PartnerBooking" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "partnerId" text NOT NULL REFERENCES "User"("id"),
  "kind" "PartnerBookingKind" NOT NULL,
  "source" "FundingSource",
  "amountCents" integer NOT NULL CHECK ("amountCents" > 0),
  "purpose" text NOT NULL CHECK (length(btrim("purpose")) >= 3),
  "receiptKey" text,
  "receiptMime" text,
  "receiptName" text,
  "bookingDate" timestamp with time zone DEFAULT now() NOT NULL,
  "ledgerEntryId" text NOT NULL UNIQUE REFERENCES "LedgerEntry"("id"),
  "createdById" text NOT NULL REFERENCES "User"("id"),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  -- Selbst erfasst ohne Beleg: aussagekräftige Begründung Pflicht
  CONSTRAINT partner_booking_reason CHECK (
    "receiptKey" IS NOT NULL OR "createdById" <> "partnerId" OR length(btrim("purpose")) >= 10
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PartnerBooking_tenant_partner_idx" ON "PartnerBooking" ("tenantId", "partnerId", "bookingDate");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "PartnerOutlayRefund" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "outlayBookingId" text NOT NULL REFERENCES "PartnerBooking"("id"),
  "refundBookingId" text NOT NULL REFERENCES "PartnerBooking"("id"),
  "amountCents" integer NOT NULL CHECK ("amountCents" > 0),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "PartnerOutlayRefund_outlay_idx" ON "PartnerOutlayRefund" ("outlayBookingId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerOutlayRefund_pair_unique" ON "PartnerOutlayRefund" ("outlayBookingId", "refundBookingId");
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PartnerBooking','PartnerOutlayRefund'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("tenantId" = app_tenant() OR app_role() = ''SUPER_ADMIN'')
         WITH CHECK ("tenantId" = app_tenant())', t);
    EXECUTE format('DROP POLICY IF EXISTS employee_no_partner ON %I', t);
    EXECUTE format('CREATE POLICY employee_no_partner ON %I AS RESTRICTIVE USING (app_role() <> ''EMPLOYEE'')', t);
  END LOOP;
END $$;
