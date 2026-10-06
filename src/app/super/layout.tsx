import { requireUser } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("SUPER_ADMIN");
  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-8">
          <div className="flex items-center gap-2.5">
            <img src="/icon.svg" alt="" className="h-8 w-8" />
            <div>
              <p className="font-semibold leading-tight">Systemverwaltung</p>
              <p className="text-xs text-muted">{user.email}</p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
    </>
  );
}
