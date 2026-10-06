import { requireUser } from "@/lib/auth";
import { listReceipts } from "@/application/receipts/receipts";
import { NavLink } from "@/components/nav-link";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin/dashboard", label: "Übersicht" },
  { href: "/admin/invoices", label: "Rechnungen" },
  { href: "/admin/contacts", label: "Kunden & Lieferanten" },
  { href: "/admin/pool", label: "Kasse & Budgets" },
  { href: "/admin/employees", label: "Mitarbeiter" },
  { href: "/admin/receipts", label: "Belege prüfen", badgeKey: "receipts" },
  { href: "/admin/reports", label: "Berichte & Abschlüsse" },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("ADMIN");
  const pending = (await listReceipts(user, { status: "SUBMITTED" })).length;
  const badge = (k?: string) => (k === "receipts" ? pending : undefined);

  return (
    <div className="md:flex">
      {/* Desktop: Seitenleiste */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0 md:flex-col md:border-r md:border-line md:bg-surface md:p-4">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{user.tenantName}</p>
            <p className="truncate text-xs text-muted">{user.name}</p>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => <NavLink key={n.href} href={n.href} badge={badge("badgeKey" in n ? n.badgeKey : undefined)}>{n.label}</NavLink>)}
        </nav>
        <div className="mt-auto px-3"><LogoutButton /></div>
      </aside>

      {/* Mobil: Kopfzeile + wischbare Navigation */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <img src="/icon.svg" alt="" className="h-7 w-7" />
            <p className="truncate font-semibold">{user.tenantName}</p>
          </div>
          <LogoutButton />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
          {NAV.map((n) => <NavLink key={n.href} href={n.href} variant="top" badge={badge("badgeKey" in n ? n.badgeKey : undefined)}>{n.label}</NavLink>)}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
