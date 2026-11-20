/**
 * Phase 0: App-DB-Rolle ohne BYPASSRLS anlegen, damit Row Level Security greift.
 *
 * Läuft als Owner (MIGRATION_DATABASE_URL).
 * Setzt/aktualisiert Login-Rolle `kmu_app` ∈ `app_user_role`.
 *
 * Env:
 *   MIGRATION_DATABASE_URL  – Owner-Verbindung
 *   APP_DB_PASSWORD         – Passwort für kmu_app (sonst generiert)
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

function sqlLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

async function main() {
  const ownerUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error("MIGRATION_DATABASE_URL fehlt");

  const password = process.env.APP_DB_PASSWORD?.trim() || randomBytes(24).toString("base64url");
  if (!process.env.APP_DB_PASSWORD?.trim()) {
    console.warn("⚠ APP_DB_PASSWORD nicht gesetzt – generiertes Passwort:");
    console.warn(`  APP_DB_PASSWORD=${password}`);
  }

  const pool = new Pool({ connectionString: ownerUrl, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user_role') THEN
          CREATE ROLE app_user_role NOLOGIN NOBYPASSRLS;
        END IF;
      END $$;
    `);

    const exists = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'kmu_app'`);
    const pw = sqlLiteral(password);
    if (exists.rowCount === 0) {
      await client.query(`
        CREATE ROLE kmu_app LOGIN PASSWORD ${pw}
          NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS
      `);
      await client.query(`GRANT app_user_role TO kmu_app`);
      console.log("✓ Rolle kmu_app angelegt (NOBYPASSRLS, IN ROLE app_user_role)");
    } else {
      await client.query(`ALTER ROLE kmu_app PASSWORD ${pw}`);
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_auth_members m
            JOIN pg_roles r ON r.oid = m.roleid
            JOIN pg_roles u ON u.oid = m.member
            WHERE r.rolname = 'app_user_role' AND u.rolname = 'kmu_app'
          ) THEN
            GRANT app_user_role TO kmu_app;
          END IF;
        END $$;
      `);
      await client.query(`ALTER ROLE kmu_app NOSUPERUSER NOBYPASSRLS INHERIT`);
      console.log("✓ Rolle kmu_app aktualisiert (Passwort + NOBYPASSRLS)");
    }

    await client.query(`GRANT USAGE ON SCHEMA public TO kmu_app`);
    await client.query(`GRANT USAGE ON SCHEMA public TO app_user_role`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user_role`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user_role`);
    await client.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user_role
    `);
    await client.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO app_user_role
    `);

    await client.query(`REVOKE UPDATE, DELETE ON "LedgerEntry" FROM app_user_role`).catch(() => undefined);
    await client.query(`GRANT UPDATE ("closingId") ON "LedgerEntry" TO app_user_role`).catch(() => undefined);

    // Neon: Rolle muss verbinden dürfen (meist implizit); explizit schadet nicht
    try {
      const db = (await client.query(`SELECT current_database() AS d`)).rows[0].d as string;
      await client.query(`GRANT CONNECT ON DATABASE ${quoteIdent(db)} TO kmu_app`);
    } catch {
      /* Neon pooler: CONNECT-Grant optional */
    }

    const check = await client.query(`
      SELECT rolname, rolcanlogin, rolbypassrls, rolsuper
      FROM pg_roles WHERE rolname = 'kmu_app'
    `);
    console.log("  attrs:", check.rows[0]);

    const u = new URL(ownerUrl.replace(/^postgresql:/, "http:"));
    const appUrl =
      `postgresql://kmu_app:${encodeURIComponent(password)}@${u.host}${u.pathname}${u.search.includes("sslmode") ? u.search : (u.search ? `${u.search}&sslmode=require` : "?sslmode=require")}`;
    console.log("");
    console.log("→ In .env.local setzen:");
    console.log(`APP_DB_PASSWORD=${password}`);
    console.log(`DATABASE_URL=${appUrl}`);
    console.log(`MIGRATION_DATABASE_URL=<Owner-URL unverändert>`);
  } finally {
    client.release();
    await pool.end();
  }
}

function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
