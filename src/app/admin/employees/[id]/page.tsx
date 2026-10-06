import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getEmployee } from "@/application/employees/employees";
import { poolOverview } from "@/application/pool/pool";
import { getSummary } from "@/application/reports/reports";
import { PageHeader, Pill, Section } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { formatCents } from "@/domain/money";
import { monthKey, todayKey } from "@/domain/period";
import { AllocationForm } from "../../pool/pool-forms";
import { WalletActions } from "../employee-forms";

export const metadata: Metadata = { title: "Mitarbeiterkonto" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("ADMIN");
  const { id } = await params;
  const today = todayKey();
  const from = `${monthKey()}-01`;
  const [emp, pool, report] = await Promise.all([
    getEmployee(user, id), poolOverview(user), getSummary(user, from, today, id),
  ]);
  const m = report.summary.employees[0];

  return (
    <>
      <PageHeader title={emp.name} subtitle={<span className="inline-flex items-center gap-2">{emp.email}{!emp.isActive && <Pill tone="red">gesperrt</Pill>}</span>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Section>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-muted">Aktuelles Guthaben</p>
                <p className="text-4xl font-semibold tracking-tight tabular">{formatCents(emp.balanceCents)}</p>
              </div>
              {m && (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm tabular sm:grid-cols-4">
                  <div><dt className="text-muted">Erhalten</dt><dd>{formatCents(m.allocatedCents)}</dd></div>
                  <div><dt className="text-muted">Belege</dt><dd>{formatCents(m.receiptsCents)}</dd></div>
                  <div><dt className="text-muted">Ausgleich</dt><dd>{formatCents(m.adjustmentsCents)}</dd></div>
                  <div><dt className="text-muted">Zurück</dt><dd>{formatCents(m.returnedCents)}</dd></div>
                </dl>
              )}
            </div>
            <p className="mt-1 text-xs text-muted">Kennzahlen für den laufenden Monat</p>
            <div className="mt-5 border-t border-line pt-4">
              <WalletActions id={emp.id} balanceCents={emp.balanceCents} isActive={emp.isActive} />
            </div>
          </Section>
          <Section title="Kontobewegungen diesen Monat" flush>
            <LedgerList rows={report.entries} mode="wallet" admin />
          </Section>
        </div>
        <Section title="Budget zuteilen">
          {emp.isActive
            ? <AllocationForm employees={[]} poolCents={pool.poolBalanceCents} presetEmployeeId={emp.id} />
            : <p className="text-sm text-muted">Gesperrte Mitarbeiter erhalten kein Budget.</p>}
        </Section>
      </div>
    </>
  );
}
