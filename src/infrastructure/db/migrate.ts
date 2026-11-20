// Wendet alle SQL-Migrationen aus ./drizzle an (inkl. RLS).
// Owner-Verbindung. Jede Datei = eigene Transaktion + COMMIT
// (ALTER TYPE … ADD VALUE erst danach nutzbar).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (oder MIGRATION_DATABASE_URL) fehlt");

  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    const journal = JSON.parse(
      readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: JournalEntry[] };

    const done = await client.query(`SELECT hash FROM drizzle.__drizzle_migrations`);
    const applied = new Set(done.rows.map((r: { hash: string }) => r.hash));

    for (const entry of journal.entries) {
      const file = join(process.cwd(), "drizzle", `${entry.tag}.sql`);
      const sql = readFileSync(file, "utf8");
      const hash = createHash("sha256").update(sql).digest("hex");
      if (applied.has(hash)) {
        console.log(`• skip ${entry.tag}`);
        continue;
      }

      console.log(`→ apply ${entry.tag}`);
      await client.query("BEGIN");
      try {
        for (const part of sql.split(/--> statement-breakpoint\s*/)) {
          const stmt = part.trim();
          if (stmt) await client.query(stmt);
        }
        await client.query(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
          [hash, entry.when ?? Date.now()],
        );
        await client.query("COMMIT");
        applied.add(hash);
        console.log(`✓ ${entry.tag}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
    console.log("✓ Migrationen angewendet");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
