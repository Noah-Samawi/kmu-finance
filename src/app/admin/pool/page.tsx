import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { poolOverview } from "@/application/pool/pool";
import { listEmployees } from "@/application/employees/employees";
import { getSummary } from "@/application/reports/reports";
import { PageHeader, Section } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { formatCents } from "@/domain/money";
import { monthKey, todayKey } from "@/domain/period";
import { AllocationForm, IncomeForm } from "./pool-forms";

export const metadata: Metadata = { title: "Kasse & Budgets" };

export default async function PoolPage() {
  const user = await requireUser("ADMIN");
  const today = todayKey();
  const [pool, employees, month] = await Promise.all([
    poolOverview(user), listEmployees(user), getSummary(user, `${monthKey()}-01`, today),
  ]);
  const p = month.summary.pool;
  const active = employees.filter((e) => e.isActive);

  return (
    <>
      <PageHeader title="Kasse & Budgets" subtitle="Einnahmen sammeln und als Budget an Mitarbeiter verteilen" />

      {/* Die Rechnung des Monats, Zeile für Zeile wie im Kassenbuch */}
      <section className="mb-6 rounded-xl border border-line bg-surface p-5 md:p-6">
        <dl className="max-w-md space-y-1.5 tabular">
          <Row label="Stand zum Monatsanfang" cents={p.openingCents} />
          <Row label="Einnahmen aus Rechnungen" cents={p.incomeInvoiceCents} sign="+" />
          <Row label="Weitere Einnahmen" cents={p.incomeManualCents} sign="+" />
          <Row label="An Mitarbeiter verteilt" cents={p.allocatedCents} sign="−" />
          <Row label="Von Mitarbeitern zurück" cents={p.returnedCents} sign="+" />
          <div className="flex items-baseline justify-between border-t-2 border-ink pt-2">
            <dt className="font-semibold">Freier Kassenbestand</dt>
            <dd className="text-3xl font-semibold tracking-tight">{formatCents(pool.poolBalanceCents)}</dd>
          </div>
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Section title="Bewegungen im Kassenbestand" flush>
          <LedgerList rows={pool.entries} mode="pool" showEmployee admin />
        </Section>
        <div className="space-y-6">
          <Section title="Budget an Mitarbeiter">
            {active.length ? <AllocationForm employees={active} poolCents={pool.poolBalanceCents} /> :
              <p className="text-sm text-muted">Lege zuerst Mitarbeiter an.</p>}
          </Section>
          <Section title="Einnahme erfassen">
            <IncomeForm today={today} />
            <p className="mt-3 text-xs text-muted">Bezahlte Rechnungen werden automatisch gebucht.</p>
          </Section>
        </div>
      </div>
    </>
  );
}

function Row({ label, cents, sign }: { label: string; cents: number; sign?: "+" | "−" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[15px]">
      <dt className="text-muted">{label}</dt>
      <dd>{sign && <span className="mr-1 text-muted">{sign}</span>}{formatCents(cents)}</dd>
    </div>
  );
}
