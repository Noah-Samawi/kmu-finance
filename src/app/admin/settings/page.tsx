import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAccountProfile } from "@/application/auth-account";
import { PageHeader } from "@/components/ui";
import { AccountSettingsForms } from "./account-forms";

export const metadata: Metadata = { title: "Kontoeinstellungen" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser("ADMIN");
  if (user.role !== "TENANT_OWNER" && user.role !== "ADMIN") {
    redirect("/admin/dashboard");
  }
  const profile = await getAccountProfile(user);

  return (
    <>
      <PageHeader
        title="Kontoeinstellungen"
        subtitle="E-Mail und Passwort für dein Inhaber-Konto"
      />
      <AccountSettingsForms email={profile.email} name={profile.name} />
      <p className="mt-6 text-sm text-muted">
        Zwei-Faktor-Authentifizierung verwalten unter{" "}
        <Link href="/admin/security" className="font-medium text-ink underline-offset-2 hover:underline">
          Sicherheit
        </Link>
        .
      </p>
    </>
  );
}
