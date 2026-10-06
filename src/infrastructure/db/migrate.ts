// Wendet alle SQL-Migrationen aus ./drizzle an (inkl. RLS).
// Muss mit einem DB-User laufen, der Tabellen anlegen darf (Owner).
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("✓ Migrationen angewendet");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
