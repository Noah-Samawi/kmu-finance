-- Phase 1 Tabellen: explizite Rechte für kmu_app (Neon: Vererbung von app_user_role
-- reicht nicht immer → 42501 beim öffentlichen Register-Insert).
GRANT SELECT, INSERT, UPDATE, DELETE ON "Company" TO app_user_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "Membership" TO app_user_role;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "PasswordResetToken" TO app_user_role;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kmu_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Company" TO kmu_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Membership" TO kmu_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PasswordResetToken" TO kmu_app;
    -- Sicherheit: Membership in app_user_role sicherstellen
    IF NOT EXISTS (
      SELECT 1 FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid
      JOIN pg_roles u ON u.oid = m.member
      WHERE r.rolname = 'app_user_role' AND u.rolname = 'kmu_app'
    ) THEN
      GRANT app_user_role TO kmu_app;
    END IF;
  END IF;
END $$;
