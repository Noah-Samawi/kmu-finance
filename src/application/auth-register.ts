import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/infrastructure/db/client";
import { companies, memberships, tenants, users } from "@/infrastructure/db/schema";
import { hashPassword } from "@/infrastructure/auth/session";
import { conflict, rule } from "@/domain/errors";
import { passwordSchema } from "@/lib/validation/schemas";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  companyName: z.string().trim().min(2, "Firmenname fehlt").max(120),
  name: z.string().trim().min(2).max(120).optional(),
});

function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "firma";
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/**
 * Öffentliche Superuser-Registrierung.
 * Tenant + User starten als PENDING – kein Datenzugriff bis Freigabe.
 */
export async function registerSuperuser(input: z.infer<typeof registerSchema>) {
  const email = input.email;
  if (await db.query.users.findFirst({ where: eq(users.email, email) })) {
    throw conflict("E-Mail ist bereits registriert");
  }
  const companyName = input.companyName.trim();
  const ownerName = (input.name?.trim() || companyName).slice(0, 120);
  const slug = slugify(companyName);

  const result = await db.transaction(async (tx) => {
    if (await tx.query.tenants.findFirst({ where: eq(tenants.slug, slug) })) {
      throw rule("Bitte erneut versuchen (Slug-Konflikt)");
    }
    const [t] = await tx.insert(tenants).values({
      name: companyName,
      slug,
      status: "PENDING",
      legalName: companyName,
      street: "noch offen",
      zip: "00000",
      city: "noch offen",
      country: "DE",
    }).returning();

    // RLS auf Company/Membership braucht app.tenant_id in derselben TX
    await tx.execute(sql`
      select set_config('app.tenant_id', ${t.id}, true),
             set_config('app.user_id', ${"register"}, true),
             set_config('app.role', ${"TENANT_OWNER"}, true),
             set_config('app.company_id', ${""}, true)`);

    const companyId = randomUUID();
    await tx.insert(companies).values({
      id: companyId,
      tenantId: t.id,
      name: companyName,
      slug,
      legalName: companyName,
      street: "noch offen",
      zip: "00000",
      city: "noch offen",
      isActive: true,
    });

    const [u] = await tx.insert(users).values({
      tenantId: t.id,
      email,
      name: ownerName,
      role: "TENANT_OWNER",
      passwordHash: await hashPassword(input.password),
      isActive: true,
      canLogin: true,
    }).returning({ id: users.id, email: users.email, name: users.name });

    await tx.insert(memberships).values({
      id: randomUUID(),
      tenantId: t.id,
      userId: u.id,
      companyId: null,
      role: "TENANT_OWNER",
    });

    return {
      tenantId: t.id,
      companyId,
      userId: u.id,
      email: u.email,
      companyName,
      status: "PENDING" as const,
      message: "Registrierung eingegangen. Nach Freigabe durch die Systemverwaltung kannst du dich anmelden.",
    };
  });

  await notifyPlatformAdminsOfRegistration(result);
  return result;
}

async function notifyPlatformAdminsOfRegistration(reg: {
  tenantId: string;
  email: string;
  companyName: string;
}) {
  const { appBaseUrl, sendEmail } = await import("@/infrastructure/email/send");
  const admins = await db.query.users.findMany({
    where: eq(users.role, "SUPER_ADMIN"),
    columns: { email: true, name: true },
  });
  if (!admins.length) return;

  const reviewUrl = `${appBaseUrl()}/super/tenants`;
  const text = [
    "Neue Superuser-Registrierung (PENDING)",
    "",
    `Firma: ${reg.companyName}`,
    `E-Mail: ${reg.email}`,
    "",
    `Freigeben unter: ${reviewUrl}`,
  ].join("\n");

  await Promise.allSettled(
    admins.map((a) =>
      sendEmail({
        to: a.email,
        subject: `Neue Registrierung: ${reg.companyName}`,
        text,
      }).catch((e) => {
        console.error("[email] admin registration notify failed", a.email, e);
      }),
    ),
  );
}
