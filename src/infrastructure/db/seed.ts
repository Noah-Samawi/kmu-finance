// Legt den Super-Admin an (idempotent). Optional: Demo-Mandant mit
// Admin und Mitarbeiter, wenn SEED_DEMO=1 gesetzt ist.
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import * as s from "./schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL });
  const db = drizzle(pool, { schema: s });

  const email = (process.env.SEED_SUPERADMIN_EMAIL ?? "super@kmu.local").toLowerCase();
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? "Super123!";

  const existing = await db.query.users.findFirst({ where: eq(s.users.email, email) });
  if (!existing) {
    await db.insert(s.users).values({
      email, name: "System-Inhaber", role: "SUPER_ADMIN",
      passwordHash: await bcrypt.hash(password, 12),
    });
    console.log(`✓ Super-Admin angelegt: ${email}`);
  } else {
    console.log(`• Super-Admin existiert bereits: ${email}`);
  }

  if (process.env.SEED_DEMO === "1") {
    const demo = await db.query.tenants.findFirst({ where: eq(s.tenants.slug, "demo-baeckerei") });
    if (!demo) {
      const [t] = await db.insert(s.tenants).values({
        name: "Demo Bäckerei", slug: "demo-baeckerei", legalName: "Demo Bäckerei GmbH",
        street: "Hauptstraße 1", zip: "60311", city: "Frankfurt am Main",
        taxNumber: "045 123 45678", vatId: "DE123456789",
        iban: "DE02120300000000202051", bic: "BYLADEM1001",
      }).returning();
      await db.insert(s.users).values([
        { tenantId: t.id, email: "chef@demo.local", name: "Clara Chef", role: "ADMIN",
          passwordHash: await bcrypt.hash("Chef123!", 12) },
        { tenantId: t.id, email: "fahrer@demo.local", name: "Max Fahrer", role: "EMPLOYEE",
          passwordHash: await bcrypt.hash("Fahrer123!", 12) },
      ]);
      console.log("✓ Demo-Mandant: chef@demo.local / Chef123!  ·  fahrer@demo.local / Fahrer123!");
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
