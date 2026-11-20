// Legt den Platform-Admin (SUPER_ADMIN) an – nur via Env, kein Hardcode in Prod.
// Optional: Demo-Tenant mit Company + TENANT_OWNER, wenn SEED_DEMO=1.
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import * as s from "./schema";

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL (oder MIGRATION_DATABASE_URL) fehlt in .env / .env.local");
  }
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const db = drizzle(pool, { schema: s });

  const email = (process.env.SEED_SUPERADMIN_EMAIL ?? "super@kmu.local").toLowerCase();
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? "Super123!";

  const existing = await db.query.users.findFirst({ where: eq(s.users.email, email) });
  if (!existing) {
    await db.insert(s.users).values({
      email, name: "System-Inhaber", role: "SUPER_ADMIN",
      passwordHash: await bcrypt.hash(password, 12),
    });
    console.log(`✓ Platform-Admin angelegt: ${email}`);
  } else {
    console.log(`• Platform-Admin existiert bereits: ${email}`);
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
      const companyId = randomUUID();
      await db.insert(s.companies).values({
        id: companyId, tenantId: t.id, name: t.name, slug: t.slug,
        legalName: t.legalName, street: t.street, zip: t.zip, city: t.city,
      });
      const ownerId = randomUUID();
      const empId = randomUUID();
      await db.insert(s.users).values([
        {
          id: ownerId, tenantId: t.id, email: "chef@demo.local", name: "Clara Chef", role: "TENANT_OWNER",
          passwordHash: await bcrypt.hash("Chef123!", 12),
        },
        {
          id: empId, tenantId: t.id, email: "fahrer@demo.local", name: "Max Fahrer", role: "EMPLOYEE",
          passwordHash: await bcrypt.hash("Fahrer123!", 12),
        },
      ]);
      await db.insert(s.memberships).values([
        { id: randomUUID(), tenantId: t.id, userId: ownerId, companyId: null, role: "TENANT_OWNER" },
        { id: randomUUID(), tenantId: t.id, userId: empId, companyId, role: "EMPLOYEE" },
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
