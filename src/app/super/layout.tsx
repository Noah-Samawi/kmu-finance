import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("SUPER_ADMIN");
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 md:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src="/icon.svg" alt="" className="h-8 w-8 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold leading-tight">Systemverwaltung</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link href="/super/tenants" className="text-sm font-medium text-muted hover:text-ink">
              Mandanten
            </Link>
            <Link href="/super/security" className="text-sm font-medium text-muted hover:text-ink">
              Sicherheit
            </Link>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
    </>
  );
}
