-- =====================================================================
-- Row Level Security: zweite Verteidigungslinie für Tenant-Isolation.
-- Die App setzt pro Request (in einer Transaktion):
--   set_config('app.tenant_id', ..., true)
--   set_config('app.user_id',   ..., true)
--   set_config('app.role',      ..., true)
-- RLS greift nur, wenn die App NICHT als Superuser/Tabellen-Owner
-- verbindet. Produktion: Login-User mit "IN ROLE app_user_role".
-- =====================================================================

-- Rolle für die Anwendung (ohne Login; Login-User erben von ihr)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user_role') THEN
    CREATE ROLE app_user_role NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_user_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user_role;
--> statement-breakpoint
-- Auch für Tabellen aus künftigen Migrationen
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user_role;
--> statement-breakpoint

-- Hilfsfunktionen
CREATE OR REPLACE FUNCTION app_tenant() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_role() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT coalesce(NULLIF(current_setting('app.role', true), ''), 'NONE') $$;
--> statement-breakpoint

-- Mandanten-Isolation
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Contact','Invoice','InvoiceSequence','LedgerEntry','Receipt','PeriodClosing'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING ("tenantId" = app_tenant() OR app_role() = ''SUPER_ADMIN'')
         WITH CHECK ("tenantId" = app_tenant())', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Rechnungspositionen erben die Sichtbarkeit ihrer Rechnung
ALTER TABLE "InvoiceItem" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "InvoiceItem" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY via_invoice ON "InvoiceItem"
  USING (EXISTS (SELECT 1 FROM "Invoice" i WHERE i."id" = "invoiceId"));
--> statement-breakpoint

-- Mitarbeiter sehen nur EIGENE Buchungen und Belege
CREATE POLICY employee_own_ledger ON "LedgerEntry" AS RESTRICTIVE
  USING (app_role() <> 'EMPLOYEE' OR "employeeId" = app_user());
--> statement-breakpoint
CREATE POLICY employee_own_receipts ON "Receipt" AS RESTRICTIVE
  USING (app_role() <> 'EMPLOYEE' OR "employeeId" = app_user());
--> statement-breakpoint

-- Mitarbeiter haben keinen Zugriff auf Rechnungen, Kunden, Abschlüsse
CREATE POLICY employee_no_invoices ON "Invoice" AS RESTRICTIVE
  USING (app_role() <> 'EMPLOYEE');
--> statement-breakpoint
CREATE POLICY employee_no_contacts ON "Contact" AS RESTRICTIVE
  USING (app_role() <> 'EMPLOYEE');
--> statement-breakpoint
CREATE POLICY employee_no_closings ON "PeriodClosing" AS RESTRICTIVE
  USING (app_role() <> 'EMPLOYEE');
--> statement-breakpoint

-- Abschluss-Prüfung auch für Mitarbeiter (die Abschlüsse selbst nicht sehen)
CREATE OR REPLACE FUNCTION period_closed(p_tenant text, p_ts timestamptz) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
      SELECT 1 FROM "PeriodClosing"
      WHERE "tenantId" = p_tenant AND "periodType" = 'MONTH'
        AND p_ts >= "periodStart" AND p_ts < "periodEnd")
  $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION period_closed(text, timestamptz) TO app_user_role;
--> statement-breakpoint

-- Hauptbuch ist append-only (GoBD)
REVOKE UPDATE, DELETE ON "LedgerEntry" FROM app_user_role;
--> statement-breakpoint
GRANT UPDATE ("closingId") ON "LedgerEntry" TO app_user_role;
--> statement-breakpoint

-- Plausibilitäts-Constraints
ALTER TABLE "Receipt" ADD CONSTRAINT receipt_amount_positive CHECK ("amountCents" > 0);
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_nonzero CHECK ("poolDeltaCents" <> 0 OR "walletDeltaCents" <> 0);
--> statement-breakpoint
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_wallet_needs_employee
  CHECK ("walletDeltaCents" = 0 OR "employeeId" IS NOT NULL);
--> statement-breakpoint

-- Saldo-Views (security_invoker: RLS gilt auch hier)
CREATE VIEW pool_balance WITH (security_invoker = true) AS
  SELECT "tenantId", SUM("poolDeltaCents")::bigint AS balance_cents
  FROM "LedgerEntry" GROUP BY "tenantId";
--> statement-breakpoint
CREATE VIEW wallet_balance WITH (security_invoker = true) AS
  SELECT "tenantId", "employeeId", SUM("walletDeltaCents")::bigint AS balance_cents
  FROM "LedgerEntry" WHERE "employeeId" IS NOT NULL
  GROUP BY "tenantId", "employeeId";
--> statement-breakpoint
GRANT SELECT ON pool_balance, wallet_balance TO app_user_role;
