import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, SESSION_COOKIE } from "@/infrastructure/auth/session";
import { homeFor } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

export const metadata: Metadata = { title: "Freigabe ausstehend" };
export const dynamic = "force-dynamic";

export default async function PendingPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await resolveSession(token);
  if (!user) redirect("/login");
  if (user.role === "SUPER_ADMIN" || user.tenantStatus === "ACTIVE") {
    redirect(homeFor(user.role));
  }
  if (user.tenantStatus !== "PENDING") redirect("/login");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-5 rounded-xl border border-line bg-surface p-6 text-center">
        <img src="/icon.svg" alt="" className="mx-auto h-12 w-12" />
        <h1 className="text-xl font-semibold tracking-tight">Freigabe ausstehend</h1>
        <p className="text-sm leading-relaxed text-muted">
          Hallo {user.name}. Dein Firmenkonto
          {user.tenantName ? <> „{user.tenantName}“</> : null} wartet noch auf Freigabe
          durch die Systemverwaltung. Du erhältst eine E-Mail, sobald du dich anmelden und
          das Dashboard nutzen kannst.
        </p>
        <div className="pt-2"><LogoutButton /></div>
      </div>
    </main>
  );
}
