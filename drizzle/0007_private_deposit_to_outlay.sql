-- Korrektur (GoBD-konform, nichts wird gelöscht): Privat ausgelegtes Geld, das als
-- "Einlage · Eigene Tasche / Privat" gebucht wurde, gehört NICHT auf das Kapitalkonto.
-- Je Fall: Storno der Einlage + neue offene Auslage (Auslagenkonto) mit Datum und Zweck des Originals.
DO $$
DECLARE
  b record;
  admin_id text;
  rev_id text;
  out_id text;
  booking_id text;
BEGIN
  FOR b IN
    SELECT pb.*, le."bookingDate" AS le_date
    FROM "PartnerBooking" pb
    JOIN "LedgerEntry" le ON le.id = pb."ledgerEntryId"
    WHERE pb.kind = 'DEPOSIT' AND pb.source = 'PRIVATE'
      AND NOT EXISTS (SELECT 1 FROM "LedgerEntry" r WHERE r."reversalOfId" = pb."ledgerEntryId")
  LOOP
    SELECT id INTO admin_id FROM "User"
      WHERE "tenantId" = b."tenantId" AND role = 'ADMIN' ORDER BY "createdAt" LIMIT 1;
    rev_id := gen_random_uuid()::text;
    out_id := gen_random_uuid()::text;
    booking_id := gen_random_uuid()::text;

    INSERT INTO "LedgerEntry" (id, "tenantId", type, "partnerDeltaCents", "employeeId", "createdById",
      "reversalOfId", "bookingDate", description)
    VALUES (rev_id, b."tenantId", 'REVERSAL', -b."amountCents", b."partnerId", coalesce(admin_id, b."createdById"),
      b."ledgerEntryId", b.le_date,
      'Storno: Umbuchung – privat ausgelegtes Geld gehört auf das Auslagenkonto, nicht auf das Kapitalkonto');

    INSERT INTO "LedgerEntry" (id, "tenantId", type, "claimDeltaCents", "employeeId", "createdById", "bookingDate", description)
    VALUES (out_id, b."tenantId", 'PARTNER_OUTLAY', b."amountCents", b."partnerId", b."createdById", b.le_date,
      'Auslage / Ausgabe für die Firma · Eigene Tasche / Privat · ' || b.purpose || ' (umgebucht aus Einlage)');

    INSERT INTO "PartnerBooking" (id, "tenantId", "partnerId", kind, source, "amountCents", purpose,
      "receiptKey", "receiptMime", "receiptName", "bookingDate", "ledgerEntryId", "createdById")
    VALUES (booking_id, b."tenantId", b."partnerId", 'OUTLAY', 'PRIVATE', b."amountCents", b.purpose,
      b."receiptKey", b."receiptMime", b."receiptName", b."bookingDate", out_id,
      CASE WHEN b."receiptKey" IS NULL AND length(btrim(b.purpose)) < 10 THEN coalesce(admin_id, b."createdById") ELSE b."createdById" END);

    INSERT INTO "AuditLog" (id, "tenantId", "actorId", action, entity, "entityId", meta)
    VALUES (gen_random_uuid()::text, b."tenantId", admin_id, 'partner.deposit-to-outlay', 'PartnerBooking', booking_id,
      jsonb_build_object('fromBooking', b.id, 'reversal', rev_id, 'outlayEntry', out_id, 'amountCents', b."amountCents"));
  END LOOP;
END $$;
