import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getSummary, listClosings, type Summary } from "@/application/reports/reports";
import { listEmployees } from "@/application/employees/employees";
import { listBranches } from "@/application/branches/branches";
import { listPersons } from "@/application/cash/cash";
import { btn, cx, Field, inputCls, PageHeader, Section } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { LedgerFilterBar } from "@/components/ledger-filter-bar";
import { AccountFlowList } from "@/components/account-flow";
import { PersonReportCard } from "@/components/person-report-view";
import { BranchReportCard } from "@/components/branch-report-view";
import { listPersonReports } from "@/application/reports/person-report";
import { listBranchReports } from "@/application/reports/branch-report";
import { UNASSIGNED_BRANCH, UNASSIGNED_BRANCH_NAME, reportScopeTitle, type BranchBalanceRow } from "@/domain/branch";
import { filterLedgerRows, parseLedgerFilter } from "@/domain/ledger-filter";
import { formatCents } from "@/domain/money";
import { fmtDate, fmtDateTime, monthKey, todayKey } from "@/domain/period";
import { ClosingForm } from "./closing-form";

export const metadata: Metadata = { title: "Berichte & Abschlüsse" };

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("ADMIN");
  const sp = await searchParams;
  const today = todayKey();
  const from = isDay(sp.from) ? sp.from! : `${monthKey()}-01`;
  const to = isDay(sp.to) ? sp.to! : today;
  const employeeId = sp.employeeId || undefined;
  const filter = parseLedgerFilter(sp);
  const branchId = filter.branchId;
  const [{ summary: s, entries }, closings, employees, allPeople, allBranches, branches, persons] = await Promise.all([
    getSummary(user, from, to, employeeId, branchId), listClosings(user), listEmployees(user), listPersonReports(user, from, to),
    listBranchReports(user, from, to), listBranches(user), listPersons(user),
  ]);
  const shown = filterLedgerRows(entries, { ...filter, branchId: undefined });
  const people = employeeId ? allPeople.filter((p) => p.person.id === employeeId) : allPeople;
  const branchReports = branchId ? allBranches.filter((r) => r.branch.id === branchId) : allBranches;
  const qs = new URLSearchParams({
    from, to,
    ...(employeeId ? { employeeId } : {}),
    ...(branchId ? { branch: branchId } : {}),
  }).toString();
  const lm = new Date(); lm.setDate(1); lm.setMonth(lm.getMonth() - 1);
  const branchName = s.scope?.branchName
    ?? (branchId === UNASSIGNED_BRANCH ? UNASSIGNED_BRANCH_NAME : branches.find((b) => b.id === branchId)?.name ?? null);
  const scopeTitle = reportScopeTitle(from, to, { branchName: branchId && branchId !== UNASSIGNED_BRANCH ? branchName : null, unassigned: branchId === UNASSIGNED_BRANCH });
  const byBranch = s.byBranch ?? [];

  return (
    <>
      <PageHeader title="Berichte & Abschlüsse"
        subtitle={`${scopeTitle} · ${fmtDate(new Date(from + "T12:00:00Z"))} bis ${fmtDate(new Date(to + "T12:00:00Z"))}`}
        actions={<>
          <a href={`/api/v1/reports/export?format=pdf&${qs}`} className={cx(btn.base, btn.primary)}>
            {branchId ? "Monatsbericht dieser Filiale" : "Monatsbericht Kasse/Bank PDF"}
          </a>
          {!branchId && (
            <a href={`/api/v1/reports/export?format=zip&from=${from}&to=${to}`}
              className={cx(btn.base, btn.primary)}
              title="Je ein PDF für jede Filiale, Zentral und Gesamt – als ZIP-Download">
              Alle Filialberichte einzeln
            </a>
          )}
          {!branchId && (
            <a href={`/api/v1/reports/export?format=pdf&${qs}`} className={cx(btn.base, btn.secondary)}>PDF für Steuerberater</a>
          )}
          <a href={`/api/v1/reports/export?format=csv&${qs}`} className={cx(btn.base, btn.secondary)}>CSV-Export</a>
        </>} />

      <form className="mb-6 grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_1.2fr_1.2fr_auto] sm:items-end md:p-5">
        {filter.q ? <input type="hidden" name="q" value={filter.q} /> : null}
        {filter.personId ? <input type="hidden" name="person" value={filter.personId} /> : null}
        {filter.account ? <input type="hidden" name="account" value={filter.account} /> : null}
        {filter.kind ? <input type="hidden" name="kind" value={filter.kind} /> : null}
        <Field label="Von"><input type="date" name="from" defaultValue={from} max={today} className={inputCls} /></Field>
        <Field label="Bis"><input type="date" name="to" defaultValue={to} max={today} className={inputCls} /></Field>
        <Field label="Filiale">
          <select name="branch" defaultValue={branchId ?? ""} className={inputCls}>
            <option value="">Alle Filialen</option>
            <option value={UNASSIGNED_BRANCH}>{UNASSIGNED_BRANCH_NAME}</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Mitarbeiter">
          <select name="employeeId" defaultValue={employeeId ?? ""} className={inputCls}>
            <option value="">Alle</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <button className={cx(btn.base, btn.primary)}>Anzeigen</button>
      </form>

      {branchId ? (
        <p className="mb-6 rounded-xl border border-ledger/20 bg-ledger-soft px-4 py-3 text-sm">
          Auswertung nur für <strong>{branchName ?? UNASSIGNED_BRANCH_NAME}</strong>
          {" – "}Anfangsbestand, Tageseinnahmen, Ausgaben, Stornos, Budgets, Rückgaben und Endbestand gelten ausschließlich für diese Filiale.
        </p>
      ) : !employeeId ? (
        <p className="mb-6 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
          Konsolidierte Gesamtsicht: Bestände und Bewegungen aller Filialen addiert. Die Tabelle darunter zeigt jede Filiale einzeln.
        </p>
      ) : null}

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
        {s.pnl && !employeeId && (
          <Section title="Gewinn & Verlust">
            <dl className="space-y-1.5 tabular">
              <Line label="Einnahmen (Tageseinnahmen + Rechnungen)" cents={s.pnl.revenueCents} />
              <Line label="Ausgaben (Betriebsausgaben)" cents={s.pnl.costsCents} />
              <Line label="Gewinn / Verlust" cents={s.pnl.resultCents} strong />
            </dl>
          </Section>
        )}
      </div>

      {!employeeId && !branchId && byBranch.length > 0 && (
        <Section title="Aufschlüsselung nach Filiale" className="mt-6" flush>
          <BranchCompareTable rows={byBranch} from={from} to={to} />
        </Section>
      )}

      <Section title="Einzelberichte je Filiale" className="mt-6">
        <p className="-mt-2 mb-4 text-sm text-muted">
          Jede Filiale hat einen eigenen Bericht mit Anfangsbestand, Einnahmen (Kasse & Bank), Ausgaben, Endbestand
          und Ergebnis – keine gemeinsame Sammeltabelle.
        </p>
        {branchReports.length === 0 ? <p className="text-sm text-muted">Noch keine Filialen.</p> : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {branchReports.map((r) => (
              <BranchReportCard key={r.branch.id} r={r} href={`/admin/reports/branch/${r.branch.id}?from=${from}&to=${to}`} />
            ))}
          </div>
        )}
      </Section>

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
        <Section title={`Einzelbuchungen (${shown.length})`} flush>
          <LedgerFilterBar action="/admin/reports" filter={filter} from={from} to={to} branches={branches} persons={persons}
            hidden={{ employeeId }} count={shown.length} />
          <LedgerList rows={shown} mode="both" showEmployee admin branches={branches} />
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
      <dt className={strong ? "" : "text-muted"}>{label}</dt>
      <dd className={cents < 0 ? "text-minus" : undefined}>{formatCents(cents)}</dd>
    </div>
  );
}

function BranchCompareTable({ rows, from, to }: { rows: BranchBalanceRow[]; from: string; to: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm tabular">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className="px-4 py-2 md:px-5">Filiale</th>
            <th className="px-2 py-2 text-right">Einnahmen</th>
            <th className="px-2 py-2 text-right">Ausgaben</th>
            <th className="px-2 py-2 text-right">Endbestand Kasse</th>
            <th className="px-2 py-2 text-right">Endbestand Bank</th>
            <th className="px-4 py-2 text-right md:px-5">Gewinn/Verlust</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const total = r.key === "total";
            const href = total ? undefined : `?${new URLSearchParams({ from, to, branch: r.key }).toString()}`;
            return (
              <tr key={r.key} className={cx(total && "border-t-2 border-ink font-semibold")}>
                <td className="px-4 py-2 md:px-5">
                  {href ? <a href={href} className="font-medium text-ledger hover:underline">{r.name}</a> : r.name}
                </td>
                <td className="px-2 py-2 text-right">{formatCents(r.incomeCents)}</td>
                <td className="px-2 py-2 text-right">{formatCents(r.expenseCents)}</td>
                <td className="px-2 py-2 text-right">{formatCents(r.cashClosingCents)}</td>
                <td className="px-2 py-2 text-right">{formatCents(r.bankClosingCents)}</td>
                <td className={cx("px-4 py-2 text-right md:px-5", r.resultCents < 0 && "text-minus")}>{formatCents(r.resultCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
