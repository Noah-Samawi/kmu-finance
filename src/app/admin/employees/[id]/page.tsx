import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getEmployee } from "@/application/employees/employees";
import { poolOverview } from "@/application/pool/pool";
import { getSummary } from "@/application/reports/reports";
import { btn, cx, PageHeader, Pill, Section } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { formatCents } from "@/domain/money";
import { DailyIncomeForm, ExpenseForm } from "@/components/cash-forms";
import { monthKey, todayKey } from "@/domain/period";
import { getPersonnelFile } from "@/application/hr/hr";
import { AllocationForm } from "../../pool/pool-forms";
import { WalletActions } from "../employee-forms";
import { HrPanel } from "../hr-panel";

export const metadata: Metadata = { title: "Mitarbeiterkonto" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("ADMIN");
  const { id } = await params;
  const today = todayKey();
  const from = `${monthKey()}-01`;
  const [emp, pool, report, hr] = await Promise.all([
    getEmployee(user, id), poolOverview(user), getSummary(user, from, today, id), getPersonnelFile(user, id),
  ]);
  const m = report.summary.employees[0];
  const person = { id: emp.id, name: emp.name, role: "EMPLOYEE" as const, isActive: emp.isActive };

  return (
    <>
      <PageHeader title={emp.name} subtitle={<span className="inline-flex items-center gap-2">{emp.email}{!emp.isActive && <Pill tone="red">gesperrt</Pill>}</span>}
        actions={<Link href={`/admin/reports/${emp.id}`} className={cx(btn.base, btn.secondary)}>Einzelbericht / Monatsbericht</Link>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Section>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-muted">Firmenbudget beim Mitarbeiter</p>
                <p className="text-4xl font-semibold tracking-tight tabular">{formatCents(emp.balanceCents)}</p>
                <p className="mt-2 text-sm">Auslagenkonto (Firma schuldet {emp.name}):{" "}
                  <span className={cx("font-semibold tabular", emp.claimCents > 0 && "text-minus")}>{formatCents(emp.claimCents)}</span>
                  {emp.claimCents > 0 && <span className="text-minus"> · offene Verbindlichkeit der Firma {formatCents(-emp.claimCents)}</span>}</p>
                <p className="text-sm">Saldo vs. Firma: <span className="font-semibold tabular">{formatCents(emp.firmBalanceCents)}</span> <span className="text-muted">(plus = Firma schuldet MA)</span></p>
              </div>
              {m && (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm tabular sm:grid-cols-5">
                  <div><dt className="text-muted">Erhalten</dt><dd>{formatCents(m.allocatedCents)}</dd></div>
                  <div><dt className="text-muted">Belege</dt><dd>{formatCents(m.receiptsCents)}</dd></div>
                  <div><dt className="text-muted">Ausgleich</dt><dd>{formatCents(m.adjustmentsCents)}</dd></div>
                  <div><dt className="text-muted">Einkäufe</dt><dd>{formatCents(m.expensesCents)}</dd></div>
                  <div><dt className="text-muted">Zurück</dt><dd>{formatCents(m.returnedCents)}</dd></div>
                </dl>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">Kennzahlen für den laufenden Monat</p>
            <div className="mt-5 border-t border-line pt-4">
              <WalletActions id={emp.id} balanceCents={emp.balanceCents} isActive={emp.isActive} canEnterCashExpense={emp.canEnterCashExpense} canEnterOutlay={emp.canEnterOutlay} claimCents={emp.claimCents} cashCents={pool.cashBalanceCents} bankCents={pool.bankBalanceCents} />
            </div>
          </Section>
          <Section title="Kontobewegungen diesen Monat" flush>
            <LedgerList rows={report.entries} mode="wallet" admin />
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Budget zuteilen">
            {emp.isActive
              ? <AllocationForm employees={[]} poolCents={pool.poolBalanceCents} cashCents={pool.cashBalanceCents} bankCents={pool.bankBalanceCents} presetEmployeeId={emp.id} />
              : <p className="text-sm text-muted">Gesperrte Mitarbeiter erhalten kein Budget.</p>}
          </Section>
          <Section title={`Ausgabe / Einkauf durch ${emp.name}`}>
            <ExpenseForm today={today} persons={[]} preset={person} funds={["BUDGET", "CASH", "BANK"]}
              balances={{ BUDGET: emp.balanceCents, CASH: pool.cashBalanceCents, BANK: pool.bankBalanceCents }} />
          </Section>
          <Section title={`Einnahme über ${emp.name}`}>
            <DailyIncomeForm today={today} persons={[]} preset={person} />
          </Section>
        </div>
      </div>
      <Section title="Digitale Personalakte" className="mt-6">
        <HrPanel employeeId={emp.id} profile={hr.profile as Record<string, unknown> | null} documents={hr.documents} payslips={hr.payslips} />
      </Section>
    </>
  );
}
