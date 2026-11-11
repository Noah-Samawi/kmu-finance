-- Firma (Mandant) komplett entfernen – nur durch den Super-Admin der Systemverwaltung.
-- Das Hauptbuch bleibt im Normalbetrieb append-only (REVOKE DELETE für app_user_role, GoBD).
-- Nur diese SECURITY-DEFINER-Funktion darf einen ganzen Mandanten samt Hauptbuch entfernen;
-- sie prüft die Session-Rolle und löscht in Fremdschlüssel-Reihenfolge.
CREATE OR REPLACE FUNCTION purge_tenant(p_tenant text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_role() <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'purge_tenant: nur Super-Admin' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = p_tenant) THEN
    RAISE EXCEPTION 'purge_tenant: Mandant nicht gefunden' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM "BankTransaction"      WHERE "tenantId" = p_tenant;
  DELETE FROM "BankStatement"        WHERE "tenantId" = p_tenant;
  DELETE FROM "PartnerOutlayRefund"  WHERE "tenantId" = p_tenant;
  DELETE FROM "PartnerBooking"       WHERE "tenantId" = p_tenant;
  DELETE FROM "LedgerCorrection"     WHERE "tenantId" = p_tenant;
  DELETE FROM "LedgerAttachment"     WHERE "tenantId" = p_tenant;
  DELETE FROM "IncomingBill"         WHERE "tenantId" = p_tenant;
  DELETE FROM "Payslip"              WHERE "tenantId" = p_tenant;
  DELETE FROM "HrDocument"           WHERE "tenantId" = p_tenant;
  DELETE FROM "EmployeeProfile"      WHERE "tenantId" = p_tenant;
  DELETE FROM "LedgerEntry"          WHERE "tenantId" = p_tenant;
  DELETE FROM "PeriodClosing"        WHERE "tenantId" = p_tenant;
  DELETE FROM "Receipt"              WHERE "tenantId" = p_tenant;
  DELETE FROM "InvoiceItem"          WHERE "invoiceId" IN (SELECT "id" FROM "Invoice" WHERE "tenantId" = p_tenant);
  DELETE FROM "Invoice"              WHERE "tenantId" = p_tenant;
  DELETE FROM "Contact"              WHERE "tenantId" = p_tenant;
  DELETE FROM "InvoiceSequence"      WHERE "tenantId" = p_tenant;
  DELETE FROM "Branch"               WHERE "tenantId" = p_tenant;
  DELETE FROM "AuditLog"             WHERE "tenantId" = p_tenant;
  DELETE FROM "User"                 WHERE "tenantId" = p_tenant; -- Sessions per ON DELETE CASCADE
  DELETE FROM "Tenant"               WHERE "id" = p_tenant;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION purge_tenant(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION purge_tenant(text) TO app_user_role;
