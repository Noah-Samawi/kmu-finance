import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { poolOverview } from "@/application/pool/pool";
import { listEmployees } from "@/application/employees/employees";
import { listPersons } from "@/application/cash/cash";
import { getSummary, listLedger } from "@/application/reports/reports";
import { listBranches } from "@/application/branches/branches";
import { LedgerFilterBar } from "@/components/ledger-filter-bar";
import { isFiltered, parseLedgerFilter } from "@/domain/ledger-filter";
import { PageHeader, Section } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { AccountFlowList } from "@/components/account-flow";
import { BalanceCorrectionForm, DailyIncomeForm, ExpenseForm } from "@/components/cash-forms";
import { formatCents } from "@/domain/money";
import { monthKey, todayKey } from "@/domain/period";
import { AllocationForm } from "../pool/pool-forms";

export const metadata: Metadata = { title: "Kasse & Bank" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function CashPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("ADMIN");
  const today = todayKey();
  const sp = await searchParams;
  const filter = parseLedgerFilter(sp);
  const from = sp.from && DAY.test(sp.from) ? sp.from : undefined;
  const to = sp.to && DAY.test(sp.to) ? sp.to : undefined;
  const filtered = isFiltered(filter) || !!from || !!to;
  const branchId = filter.branchId;
  const [pool, employees, persons, month, day, branches] = await Promise.all([
    poolOverview(user), listEmployees(user), listPersons(user),
    getSummary(user, `${monthKey()}-01`, today, undefined, branchId),
    getSummary(user, today, today, undefined, branchId),
    listBranches(user),
  ]);
  const moneyRows = filtered
    ? (await listLedger(user, { from, to, filter, limit: 500 })).filter((r) => r.cashDeltaCents !== 0 || r.bankDeltaCents !== 0)
    : pool.entries;
  const cats = month.summary.totals.expensesByCategory;
  const active = employees.filter((e) => e.isActive);
  const accounts = [
    { key: "CASH" as const, title: "Kasse (Bar)", now: branchId ? month.summary.cash.closingCents : pool.cashBalanceCents, month: month.summary.cash, today: day.summary.cash },
    { key: "BANK" as const, title: "Bankkonto", now: branchId ? month.summary.bank.closingCents : pool.bankBalanceCents, month: month.summary.bank, today: day.summary.bank },
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
              {a.today.priorReversalCents !== 0 && <Row label="Stornos früherer Buchungen" cents={a.today.priorReversalCents} sign="±" />}
              <Row label="Weitere Bewegungen (Rechnungen, Budget, Korrekturen …)" cents={a.today.closingCents - a.today.openingCents - a.today.dailyIncomeCents + a.today.expenseCents - a.today.priorReversalCents} sign="±" />
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
          <DailyIncomeForm today={today} persons={persons} branches={branches} />
        </Section>
        <Section title="Ausgabe erfassen (Wareneinkauf / Betriebskosten)">
          <ExpenseForm today={today} persons={persons} balances={{ CASH: pool.cashBalanceCents, BANK: pool.bankBalanceCents }} branches={branches} />
          <p className="mt-3 text-xs text-muted">
            Lieferantenrechnung mit Status Offen / Bezahlt / Guthaben?{" "}
            <a href="/admin/invoices?tab=in" className="text-ledger hover:underline">Eingangsrechnung hochladen</a>
            {" · "}
            <a href="/admin/bank" className="text-ledger hover:underline">oder unter Kontoauszüge</a>
          </p>
        </Section>
        <Section title="Bestand korrigieren (Stichtag)">
          <BalanceCorrectionForm today={today} />
        </Section>
      </div>

      <Section title="Bewegungen Kasse (Bar) und Bankkonto – je Buchung mit Konto" flush>
        <LedgerFilterBar action="/admin/cash" filter={filter} from={from} to={to} branches={branches} persons={persons}
          count={filtered ? moneyRows.length : undefined} />
        <LedgerList rows={moneyRows} mode="pool" showEmployee admin branches={branches}
          emptyTitle={filtered ? "Keine Buchungen für diesen Filter" : undefined} />
      </Section>
    </>
  );
}

function Row({ label, cents, sign }: { label: string; cents: number; sign?: "+" | "−" | "±" }) {
  const prefix = sign === "±" ? "±" : sign === "−" ? "−" : cents < 0 ? null : sign === "+" ? "+" : null;
  return (
    <div className="flex items-baseline justify-between gap-4 text-[15px]">
      <dt className="text-muted">{label}</dt>
      <dd className={cents < 0 ? "text-minus" : undefined}>
        {prefix && <span className="me-1 text-muted">{prefix}</span>}
        {formatCents(cents)}
      </dd>
    </div>
  );
}
