import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { adminDashboard } from "@/application/dashboard";
import { ButtonLink, Empty, Money, PageHeader, Section } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { formatCents } from "@/domain/money";
import { zoned } from "@/domain/period";

export const metadata: Metadata = { title: "Übersicht" };

export default async function DashboardPage() {
  const user = await requireUser("ADMIN");
  const d = await adminDashboard(user);
  const monthName = zoned(new Date()).toLocaleDateString("de-DE", { month: "long" });

  return (
    <>
      <PageHeader
        title={`Guten Tag, ${user.name.split(" ")[0]}`}
        actions={<>
          <ButtonLink href="/admin/invoices/new" variant="primary">Rechnung schreiben</ButtonLink>
          <ButtonLink href="/admin/cash">Kasse &amp; Bank</ButtonLink>
        </>}
      />

      {/* Kassengleichung: das Herzstück der Übersicht */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        {([["Kasse (Bar)", d.cashBalanceCents, d.month.cash], ["Bankkonto", d.bankBalanceCents, d.month.bank]] as const).map(([title, now, m]) => (
          <section key={title} className="rounded-xl border border-line bg-surface p-5 md:p-6">
            <p className="text-sm font-medium text-muted">{title}</p>
            <p className="mt-1 text-4xl font-semibold tracking-tight tabular">{formatCents(now)}</p>
            <p className="mt-2 text-sm text-muted">
              {`Im ${monthName}: Tageseinnahmen ${formatCents(m.dailyIncomeCents)} · Rechnungseingänge ${formatCents(m.invoiceIncomeCents)} · Ausgaben ${formatCents(m.expenseCents)}`}
            </p>
          </section>
        ))}
      </div>
      <p className="mb-6 max-w-3xl text-muted">
        Im {monthName}: <Money cents={-d.month.allocatedCents} signed /> als Budget verteilt.
        Mitarbeiter haben {formatCents(d.month.receiptsCents)} mit Beleg ausgegeben
        {d.month.adjustmentsCents > 0 && <> und {formatCents(d.month.adjustmentsCents)} ohne Beleg ausgeglichen</>}.
      </p>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Link href="/admin/invoices?status=OPEN" className="rounded-xl border border-line bg-surface p-4 hover:border-ink/30">
          <p className="text-sm text-muted">Offene Rechnungen</p>
          <p className="mt-1 text-xl font-semibold tabular">{formatCents(d.invoices.openCents)}</p>
          <p className="text-sm text-muted">{d.invoices.openCount} Stück</p>
        </Link>
        <Link href="/admin/invoices?status=OVERDUE"
          className={`rounded-xl border p-4 ${d.invoices.overdueCount ? "border-amber/40 bg-amber-soft" : "border-line bg-surface"} hover:border-ink/30`}>
          <p className={`text-sm ${d.invoices.overdueCount ? "text-amber" : "text-muted"}`}>Überfällig</p>
          <p className="mt-1 text-xl font-semibold tabular">{formatCents(d.invoices.overdueCents)}</p>
          <p className="text-sm text-muted">{d.invoices.overdueCount ? `${d.invoices.overdueCount} Rechnung(en) mahnen` : "Alles im Plan"}</p>
        </Link>
        <Link href="/admin/receipts" className="rounded-xl border border-line bg-surface p-4 hover:border-ink/30">
          <p className="text-sm text-muted">Belege zur Prüfung</p>
          <p className="mt-1 text-xl font-semibold tabular">{d.pendingReceipts}</p>
          <p className="text-sm text-muted">bereits vom Guthaben abgezogen</p>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Section title="Guthaben bei Mitarbeitern" actions={<span className="text-sm font-semibold tabular">{formatCents(d.walletsOpenCents)}</span>} flush>
          {d.employees.length === 0 ? (
            <Empty title="Noch kein Budget verteilt"><Link href="/admin/employees" className="text-ledger hover:underline">Mitarbeiter anlegen</Link></Empty>
          ) : (
            <ul className="divide-y divide-line">
              {d.employees.map((e) => (
                <li key={e.employeeId}>
                  <Link href={`/admin/employees/${e.employeeId}`} className="flex items-center justify-between px-4 py-3 hover:bg-paper md:px-5">
                    <span>
                      <span className="font-medium">{e.name}</span>
                      <span className="block text-sm text-muted">Diesen Monat {formatCents(e.receiptsCents)} belegt
                        {e.claimClosingCents ? ` · Anspruch ${formatCents(e.claimClosingCents)}` : ""}</span>
                    </span>
                    <Money cents={e.firmBalanceCents} className="font-semibold" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Letzte Buchungen" actions={<Link href="/admin/reports" className="text-sm font-medium text-ledger hover:underline">Alle anzeigen</Link>} flush>
          <LedgerList rows={d.recent} mode="both" showEmployee admin />
        </Section>
      </div>
    </>
  );
}
