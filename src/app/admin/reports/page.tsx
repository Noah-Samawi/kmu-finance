import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getSummary, listClosings, type Summary } from "@/application/reports/reports";
import { listEmployees } from "@/application/employees/employees";
import { btn, cx, Field, inputCls, Money, PageHeader, Section, Table, td } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { AccountFlowList } from "@/components/account-flow";
import { PersonReportCard } from "@/components/person-report-view";
import { listPersonReports } from "@/application/reports/person-report";
import { formatCents } from "@/domain/money";
import { fmtDate, fmtDateTime, monthKey, todayKey } from "@/domain/period";
import { ClosingForm } from "./closing-form";

export const metadata: Metadata = { title: "Berichte & Abschlüsse" };

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; employeeId?: string }> }) {
  const user = await requireUser("ADMIN");
  const sp = await searchParams;
  const today = todayKey();
  const from = isDay(sp.from) ? sp.from! : `${monthKey()}-01`;
  const to = isDay(sp.to) ? sp.to! : today;
  const employeeId = sp.employeeId || undefined;
  const [{ summary: s, entries }, closings, employees, allPeople] = await Promise.all([
    getSummary(user, from, to, employeeId), listClosings(user), listEmployees(user), listPersonReports(user, from, to),
  ]);
  const people = employeeId ? allPeople.filter((p) => p.person.id === employeeId) : allPeople;
  const qs = new URLSearchParams({ from, to, ...(employeeId ? { employeeId } : {}) }).toString();
  const lm = new Date(); lm.setDate(1); lm.setMonth(lm.getMonth() - 1);

  return (
    <>
      <PageHeader title="Berichte & Abschlüsse" subtitle={`Zeitraum ${fmtDate(new Date(from + "T12:00:00Z"))} bis ${fmtDate(new Date(to + "T12:00:00Z"))}`}
        actions={<>
          <a href={`/api/v1/reports/export?format=pdf&${qs}`} className={cx(btn.base, btn.secondary)}>PDF für Steuerberater</a>
          <a href={`/api/v1/reports/export?format=pdf&${qs}&split=1`} className={cx(btn.base, btn.primary)}>Monatsbericht Kasse/Bank PDF</a>
          <a href={`/api/v1/reports/export?format=csv&${qs}`} className={cx(btn.base, btn.secondary)}>CSV-Export</a>
        </>} />

      <form className="mb-6 grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end md:p-5">
        <Field label="Von"><input type="date" name="from" defaultValue={from} max={today} className={inputCls} /></Field>
        <Field label="Bis"><input type="date" name="to" defaultValue={to} max={today} className={inputCls} /></Field>
        <Field label="Mitarbeiter">
          <select name="employeeId" defaultValue={employeeId ?? ""} className={inputCls}>
            <option value="">Alle</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <button className={cx(btn.base, btn.primary)}>Anzeigen</button>
      </form>

      {!employeeId && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <Section title="Kasse (Bar)"><AccountFlowList account="CASH" flow={s.cash} /></Section>
          <Section title="Bankkonto"><AccountFlowList account="BANK" flow={s.bank} /></Section>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Ausgaben im Zeitraum">
          <dl className="space-y-1.5 tabular">
            {!employeeId && <Line label="Ausgaben Kasse (Bar)" cents={s.cash.expenseCents} />}
            {!employeeId && <Line label="Ausgaben Bankkonto" cents={s.bank.expenseCents} />}
            <Line label="Mit Beleg" cents={s.totals.receiptsCents} />
            <Line label="Ausgleich ohne Beleg" cents={s.totals.adjustmentsCents} />
            {s.totals.expensesByCategory.map((c) => <Line key={c.category} label={`Betriebsausgabe: ${c.label}`} cents={c.cents} />)}
            <Line label="Betriebsausgaben gesamt" cents={s.totals.expensesCents} />
            <Line label="Offene Budgets am Ende" cents={s.totals.walletsOpenCents} />
            <Line label="Offene Auslagen-Ansprüche" cents={s.totals.claimsOpenCents ?? 0} strong />
          </dl>
        </Section>
      </div>

      <Section title="Einzelberichte je Person" className="mt-6">
        <p className="-mt-2 mb-4 text-sm text-muted">
          Jede Person hat einen eigenen Bericht mit Anfangsbestand, Einnahmen, Ausgaben, Restbetrag, Rückgaben an die Firma
          und allen Transfers aus Kasse/Bank – keine gemeinsame Sammeltabelle.
        </p>
        {people.length === 0 ? <p className="text-sm text-muted">Noch keine Mitarbeiter oder Gesellschafter.</p> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {people.map((r) => <PersonReportCard key={r.person.id} r={r} href={`/admin/reports/${r.person.id}?from=${from}&to=${to}`} />)}
          </div>
        )}
      </Section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Section title={`Einzelbuchungen (${entries.length})`} flush>
          <LedgerList rows={entries} mode="both" showEmployee admin />
        </Section>
        <div className="space-y-6">
          <Section title="Abschließen">
            <ClosingForm today={today} lastMonth={`${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, "0")}`} />
          </Section>
          <Section title="Bisherige Abschlüsse" flush>
            {closings.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Noch keine Abschlüsse.</p> : (
              <ul className="divide-y divide-line">
                {closings.map((c) => {
                  const t = c.totals as Summary;
                  const fromKey = todayKey(c.periodStart), toKey = todayKey(new Date(c.periodEnd.getTime() - 1));
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 md:px-5">
                      <div>
                        <p className="font-medium">{c.periodType === "DAY" ? `Tag ${fmtDate(c.periodStart)}` : `Monat ${c.periodStart.toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "Europe/Berlin" })}`}</p>
                        <p className="text-xs text-muted">{`${c.closedByName}, ${fmtDateTime(c.closedAt)} – Kasse (Bar) ${formatCents(t.cash?.closingCents ?? 0)} · Bankkonto ${formatCents(t.bank?.closingCents ?? 0)}`}</p>
                      </div>
                      <a className="text-sm font-medium text-ledger hover:underline" href={`/api/v1/reports/export?format=pdf&from=${fromKey}&to=${toKey}`}>PDF</a>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

function Line({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className={cx("flex justify-between gap-4", strong && "border-t border-ink/70 pt-1.5 font-semibold")}>
      <dt className={strong ? "" : "text-muted"}>{label}</dt><dd>{formatCents(cents)}</dd>
    </div>
  );
}
