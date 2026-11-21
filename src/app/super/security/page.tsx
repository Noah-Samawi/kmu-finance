import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/infrastructure/db/client";
import { users } from "@/infrastructure/db/schema";
import { PageHeader } from "@/components/ui";
import { SecurityTotpPanel } from "@/app/admin/security/security-form";

export const metadata: Metadata = { title: "Sicherheit" };
export const dynamic = "force-dynamic";

export default async function SuperSecurityPage() {
  const user = await requireUser("SUPER_ADMIN");
  const row = await db.query.users.findFirst({
    where: eq(users.id, user.userId),
    columns: { totpEnabled: true, totpVerifiedAt: true },
  });

  return (
    <>
      <PageHeader
        title="Sicherheit"
        subtitle="Zwei-Faktor-Authentifizierung für deinen Platform-Admin-Login"
      />
      <SecurityTotpPanel
        totpEnabled={!!row?.totpEnabled}
        totpVerifiedAt={row?.totpVerifiedAt?.toISOString() ?? null}
      />
    </>
  );
}
