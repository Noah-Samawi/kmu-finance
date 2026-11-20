import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/infrastructure/db/client";
import { users } from "@/infrastructure/db/schema";
import { PageHeader } from "@/components/ui";
import { SecurityTotpPanel } from "./security-form";

export const metadata: Metadata = { title: "Sicherheit" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const user = await requireUser("ADMIN");
  if (user.role !== "TENANT_OWNER" && user.role !== "ADMIN") {
    redirect("/admin/dashboard");
  }
  const row = await db.query.users.findFirst({
    where: eq(users.id, user.userId),
    columns: { totpEnabled: true, totpVerifiedAt: true },
  });

  return (
    <>
      <PageHeader
        title="Sicherheit"
        subtitle="Zwei-Faktor-Authentifizierung für dein Konto-Inhaber-Login"
      />
      <SecurityTotpPanel
        totpEnabled={!!row?.totpEnabled}
        totpVerifiedAt={row?.totpVerifiedAt?.toISOString() ?? null}
      />
    </>
  );
}
