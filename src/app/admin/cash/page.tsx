import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { poolOverview } from "@/application/pool/pool";
import { listEmployees } from "@/application/employees/employees";
import { listPersons } from "@/application/cash/cash";
import { getSummary } from "@/application/reports/reports";
import { PageHeader, Section } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { BalanceCorrectionForm, DailyIncomeForm, ExpenseForm } from "@/components/cash-forms";
import { formatCents } from "@/domain/money";
import { monthKey, todayKey } from "@/domain/period";
import { AllocationForm } from "../pool/pool-forms";

export const metadata: Metadata = { title: "Kasse & Bank" };

export default async function CashPage() {
  const user = await requireUser("ADMIN");
  const today = todayKey();
  const [pool, employees, persons, month] = await Promise.all([
    poolOverview(user), listEmployees(user), listPersons(user), getSummary(user, `${monthKey()}-01`, today),
  ]);
  const p = month.summary.pool;
  const cats = month.summary.totals.expensesByCategory;
  const active = employees.filter((e) => e.isActive);

  return (
    <>
      <PageHeader title="Kasse & Bank" subtitle="Tageseinnahmen, Gastro-Ausgaben und Bestandskorrekturen – getrennte Bestände, lückenlos protokolliert." />

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-xl border border-line bg-surface p-5 md:p-6">
          <p className="mb-3 text-sm font-medium text-muted">Laufender Monat</p>
          <dl className="space-y-1.5 tabular">
            <Row label="Stand zum Monatsanfang" cents={p.openingCents} />
            <Row label="Einnahmen aus Rechnungen" cents={p.incomeInvoiceCents} sign="+" />
            <Row label="Tageseinnahmen / weitere Einnahmen" cents={p.incomeManualCents} sign="+" />
            <Row label="Betriebsausgaben (Kasse/Bank)" cents={p.expenseCents} sign="−" />
            <Row label="Budget an Personen" cents={p.allocatedCents} sign="−" />
            <Row label="Rückgaben von Personen" cents={p.returnedCents} sign="+" />
            <Row label="Korrekturen, Gesellschafter, Erstattungen" cents={p.otherCents} sign="±" />
            <div className="flex items-baseline justify-between border-t-2 border-ink pt-2">
              <dt className="font-semibold">Bestand jetzt</dt>
              <dd className="text-3xl font-semibold tracking-tight">{formatCents(pool.poolBalanceCents)}</dd>
            </div>
            <Row label="davon Kasse (Bar)" cents={pool.cashBalanceCents} />
            <Row label="davon Bankkonto" cents={pool.bankBalanceCents} />
          </dl>
        </section>
        <Section title="Ausgaben diesen Monat nach Kategorie">
          {cats.length ? (
            <dl className="space-y-1.5 tabular">
              {cats.map((c) => <Row key={c.category} label={c.label} cents={c.cents} />)}
              <div className="flex items-baseline justify-between border-t border-line pt-2 font-semibold">
                <dt>Summe Betriebsausgaben</dt><dd>{formatCents(month.summary.totals.expensesCents)}</dd>
              </div>
            </dl>
          ) : <p className="text-sm text-muted">Noch keine Betriebsausgaben in diesem Monat.</p>}
          <p className="mt-3 text-xs text-muted">Enthält auch Einkäufe aus dem Budget von Mitarbeitern und vom Kapitalkonto von Gesellschaftern.</p>
        </Section>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Section title="Tageseinnahme erfassen">
          <DailyIncomeForm today={today} persons={persons} />
        </Section>
        <Section title="Ausgabe erfassen (Wareneinkauf / Betriebskosten)">
          <ExpenseForm today={today} persons={persons} balances={{ CASH: pool.cashBalanceCents, BANK: pool.bankBalanceCents }} />
        </Section>
        <div className="space-y-6">
          <Section title="Bestand korrigieren (Stichtag)">
            <BalanceCorrectionForm today={today} />
          </Section>
          <Section title="Budget an Mitarbeiter">
            {active.length
              ? <AllocationForm employees={active} poolCents={pool.poolBalanceCents} cashCents={pool.cashBalanceCents} bankCents={pool.bankBalanceCents} />
              : <p className="text-sm text-muted">Lege zuerst Mitarbeiter an.</p>}
          </Section>
        </div>
      </div>

      <Section title="Bewegungen Kasse & Bank" flush>
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
