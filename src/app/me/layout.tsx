import { requireUser } from "@/lib/auth";
import { NavLink } from "@/components/nav-link";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

// Mitarbeiter-App: für das Handy gebaut, Navigation unten in Daumenreichweite
export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("EMPLOYEE");
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col">
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted">{user.tenantName}</p>
          <p className="truncate font-semibold">{user.name}</p>
        </div>
        <LogoutButton />
      </header>
      <main className="flex-1 px-4 pb-28">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-md">
          <NavLink href="/me" variant="bottom"><IconWallet />Konto</NavLink>
          <NavLink href="/me/receipts/new" variant="bottom"><IconCamera />Beleg</NavLink>
          <NavLink href="/me/history" variant="bottom"><IconList />Verlauf</NavLink>
        </div>
      </nav>
    </div>
  );
}

const ic = "h-6 w-6 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]";
function IconWallet() {
  return <svg viewBox="0 0 24 24" className={ic} aria-hidden><path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1z" /><path d="M4 7l11-3v3" /><circle cx="16" cy="13.5" r="1.2" /></svg>;
}
function IconCamera() {
  return <svg viewBox="0 0 24 24" className={ic} aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>;
}
function IconList() {
  return <svg viewBox="0 0 24 24" className={ic} aria-hidden><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>;
}
