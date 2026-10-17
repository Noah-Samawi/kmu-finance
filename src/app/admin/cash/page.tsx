import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { poolOverview } from "@/application/pool/pool";
import { listEmployees } from "@/application/employees/employees";
import { listPersons } from "@/application/cash/cash";
import { getSummary } from "@/application/reports/reports";
import { PageHeader, Section } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { AccountFlowList } from "@/components/account-flow";
import { BalanceCorrectionForm, DailyIncomeForm, ExpenseForm } from "@/components/cash-forms";
import { formatCents } from "@/domain/money";
import { monthKey, todayKey } from "@/domain/period";
import { AllocationForm } from "../pool/pool-forms";

export const metadata: Metadata = { title: "Kasse & Bank" };

export default async function CashPage() {
  const user = await requireUser("ADMIN");
  const today = todayKey();
  const [pool, employees, persons, month, day] = await Promise.all([
    poolOverview(user), listEmployees(user), listPersons(user),
    getSummary(user, `${monthKey()}-01`, today), getSummary(user, today, today),
  ]);
  const cats = month.summary.totals.expensesByCategory;
  const active = employees.filter((e) => e.isActive);
  const accounts = [
    { key: "CASH" as const, title: "Kasse (Bar)", now: pool.cashBalanceCents, month: month.summary.cash, today: day.summary.cash },
    { key: "BANK" as const, title: "Bankkonto", now: pool.bankBalanceCents, month: month.summary.bank, today: day.summary.bank },
  ];

  return (
    <>
      <PageHeader title="Kasse & Bank" subtitle="Kasse (Bar) und Bankkonto als getrennte Konten – Tageseinnahmen, Ausgaben und Korrekturen je Konto, lückenlos protokolliert." />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {accounts.map((a) => (
          <section key={a.key} className="rounded-xl border border-line bg-surface p-5 md:p-6" aria-label={a.title}>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold">{a.title}</h2>
              <p className="text-right">
                <span className="block text-xs text-muted">Bestand jetzt</span>
                <span className="text-3xl font-semibold tracking-tight tabular">{formatCents(a.now)}</span>
              </p>
            </div>
            <p className="mb-2 text-sm font-medium text-muted">Heute</p>
            <dl className="mb-4 space-y-1 rounded-lg bg-paper px-3 py-2 tabular">
              <Row label={`Tageseinnahmen ${a.title}`} cents={a.today.dailyIncomeCents} sign="+" />
              <Row label={`Ausgaben ${a.title}`} cents={a.today.expenseCents} sign="−" />
              <Row label="Weitere Bewegungen (Rechnungen, Budget, Korrekturen …)" cents={a.today.closingCents - a.today.openingCents - a.today.dailyIncomeCents + a.today.expenseCents} sign="±" />
            </dl>
            <p className="mb-2 text-sm font-medium text-muted">Laufender Monat</p>
            <AccountFlowList account={a.key} flow={a.month} />
          </section>
        ))}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Section title="Ausgaben diesen Monat nach Kategorie">
          {cats.length ? (
            <dl className="space-y-1.5 tabular">
              {cats.map((c) => <Row key={c.category} label={c.label} cents={c.cents} />)}
              <div className="flex items-baseline justify-between border-t border-line pt-2 font-semibold">
                <dt>Summe Betriebsausgaben</dt><dd>{formatCents(month.summary.totals.expensesCents)}</dd>
              </div>
            </dl>
          ) : <p className="text-sm text-muted">Noch keine Betriebsausgaben in diesem Monat.</p>}
          <p className="mt-3 text-xs text-muted">
            {`Davon aus Kasse (Bar) ${formatCents(month.summary.cash.expenseCents)} · vom Bankkonto ${formatCents(month.summary.bank.expenseCents)} – der Rest aus Budgets von Mitarbeitern bzw. Kapitalkonten von Gesellschaftern.`}
          </p>
        </Section>
        <Section title="Budget an Mitarbeiter">
          {active.length
            ? <AllocationForm employees={active} poolCents={pool.poolBalanceCents} cashCents={pool.cashBalanceCents} bankCents={pool.bankBalanceCents} />
            : <p className="text-sm text-muted">Lege zuerst Mitarbeiter an.</p>}
        </Section>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Section title="Tageseinnahme erfassen">
          <DailyIncomeForm today={today} persons={persons} />
        </Section>
        <Section title="Ausgabe erfassen (Wareneinkauf / Betriebskosten)">
          <ExpenseForm today={today} persons={persons} balances={{ CASH: pool.cashBalanceCents, BANK: pool.bankBalanceCents }} />
        </Section>
        <Section title="Bestand korrigieren (Stichtag)">
          <BalanceCorrectionForm today={today} />
        </Section>
      </div>

      <Section title="Bewegungen Kasse (Bar) und Bankkonto – je Buchung mit Konto" flush>
        <LedgerList rows={pool.entries} mode="pool" showEmployee admin />
      </Section>
    </>
  );
}

function Row({ label, cents, sign }: { label: string; cents: number; sign?: "+" | "−" | "±" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[15px]">
      <dt className="text-muted">{label}</dt>
      <dd>{sign && <span className="me-1 text-muted">{sign}</span>}{formatCents(cents)}</dd>
    </div>
  );
}
