import { requireUser } from "@/lib/auth";
import { NavLink } from "@/components/nav-link";
import { LogoutButton } from "@/components/logout-button";
import { LanguageSwitcher } from "@/components/i18n";
import { getT } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("PARTNER");
  const t = await getT();
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted">{user.tenantName}</p>
          <p className="truncate font-semibold">{user.name} · {t("partner.role")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <LanguageSwitcher />
          <LogoutButton />
        </div>
      </header>
      <nav className="flex gap-2 px-4 pb-2">
        <NavLink href="/partner" variant="top">{t("nav.partner.capital")}</NavLink>
        <NavLink href="/partner/reports" variant="top">{t("nav.partner.reports")}</NavLink>
      </nav>
      <main className="flex-1 px-4 pb-10">{children}</main>
    </div>
  );
}
