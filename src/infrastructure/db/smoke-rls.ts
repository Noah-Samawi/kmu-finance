/**
 * Phase-0-Smoke: Prüft, dass die App-Verbindung RLS nicht umgeht.
 * Erwartung:
 *  - current_user = kmu_app, rolbypassrls = false
 *  - ohne app.tenant_id: 0 Zeilen in LedgerEntry
 *  - mit gültigem tenant_id (in derselben Transaktion): > 0 falls Daten existieren
 */
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL fehlt");

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const me = await client.query(`
      SELECT current_user AS usr,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass
    `);
    const { usr, bypass } = me.rows[0] as { usr: string; bypass: boolean };
    console.log(`user=${usr} bypassrls=${bypass}`);

    if (usr === "neondb_owner" || bypass === true) {
      throw new Error("FAIL: App verbindet noch als Owner/BYPASSRLS – DATABASE_URL auf kmu_app umstellen");
    }
    if (usr !== "kmu_app") {
      console.warn(`WARN: erwartet kmu_app, ist ${usr}`);
    }

    // set_config(..., true) gilt nur INNERHALB einer Transaktion
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.tenant_id', '', true), set_config('app.role', 'NONE', true)`);
    const empty = await client.query(`SELECT count(*)::int AS n FROM "LedgerEntry"`);
    const nEmpty = empty.rows[0].n as number;
    console.log(`ledger ohne tenant GUC: ${nEmpty}`);
    if (nEmpty !== 0) {
      throw new Error(`FAIL: RLS greift nicht – erwartet 0 Zeilen, gesehen ${nEmpty}`);
    }
    await client.query("ROLLBACK");

    const tenants = await client.query(`SELECT id, name FROM "Tenant" ORDER BY "createdAt"`);
    console.log(`tenants sichtbar (keine RLS auf Tenant): ${tenants.rowCount}`);

    let seenScoped = 0;
    for (const t of tenants.rows as { id: string; name: string }[]) {
      await client.query("BEGIN");
      await client.query(
        `SELECT set_config('app.tenant_id', $1, true), set_config('app.role', 'ADMIN', true)`,
        [t.id],
      );
      const scoped = await client.query(`SELECT count(*)::int AS n FROM "LedgerEntry"`);
      const branches = await client.query(`SELECT count(*)::int AS n FROM "Branch"`);
      const n = scoped.rows[0].n as number;
      console.log(`tenant ${t.name}: ledger=${n} branches=${branches.rows[0].n}`);
      if (n > 0) seenScoped = n;
      await client.query("ROLLBACK");
    }
    if (tenants.rowCount && tenants.rowCount > 0 && seenScoped === 0) {
      console.warn("WARN: kein Tenant hat Ledger-Zeilen (leere DB ok in Dev)");
    }

    const users = await client.query(`SELECT count(*)::int AS n FROM "User"`);
    console.log(`users lesbar (keine RLS auf User): ${users.rows[0].n}`);

    console.log("✓ Phase-0-Smoke OK – RLS aktiv für App-Verbindung");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
