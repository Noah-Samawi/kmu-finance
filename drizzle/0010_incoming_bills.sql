-- Eingangsrechnungen / Lieferantenbelege: Zahlungskanal (Bar/Bank/offen) ist Pflicht,
-- Status (offen / bezahlt / Guthaben) wird aus Betrag und gezahltem Betrag gelesen.
CREATE TABLE IF NOT EXISTS "IncomingBill" (
  "id" text PRIMARY KEY NOT NULL,
  "tenantId" text NOT NULL REFERENCES "Tenant"("id"),
  "supplier" text NOT NULL,
  "amountCents" integer NOT NULL,
  "paidCents" integer DEFAULT 0 NOT NULL,
  "payKind" text NOT NULL,
  "fund" "AccountKind",
  "category" text,
  "purpose" text,
  "bookingDate" timestamp with time zone NOT NULL,
  "branchId" text REFERENCES "Branch"("id"),
  "fileKey" text,
  "fileMime" text,
  "fileName" text,
  "fileSha256" text,
  "ledgerEntryId" text UNIQUE REFERENCES "LedgerEntry"("id"),
  "canceledAt" timestamp with time zone,
  "cancelReason" text,
  "createdById" text NOT NULL REFERENCES "User"("id"),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "IncomingBill_payKind_check" CHECK ("payKind" IN ('CASH', 'BANK', 'UNPAID')),
  CONSTRAINT "IncomingBill_amount_check" CHECK ("amountCents" > 0),
  CONSTRAINT "IncomingBill_paid_check" CHECK ("paidCents" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "IncomingBill_tenant_sha_key" ON "IncomingBill" ("tenantId", "fileSha256")
  WHERE "fileSha256" IS NOT NULL AND "canceledAt" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IncomingBill_tenant_date_idx" ON "IncomingBill" ("tenantId", "bookingDate");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IncomingBill_tenant_supplier_idx" ON "IncomingBill" ("tenantId", "supplier");
--> statement-breakpoint
ALTER TABLE "IncomingBill" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "IncomingBill" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "IncomingBill";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "IncomingBill"
  USING ("tenantId" = app_tenant() OR app_role() = 'SUPER_ADMIN')
  WITH CHECK ("tenantId" = app_tenant());
--> statement-breakpoint
REVOKE DELETE ON "IncomingBill" FROM app_user_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "IncomingBill" TO app_user_role;
