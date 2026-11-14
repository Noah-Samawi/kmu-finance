import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listEmployees } from "@/application/employees/employees";
import { listBranches } from "@/application/branches/branches";
import { poolOverview } from "@/application/pool/pool";
import { Empty, Money, PageHeader, Pill, Section } from "@/components/ui";
import { formatCents } from "@/domain/money";
import { fmtDateTime } from "@/domain/period";
import { CreateEmployeeForm, EmployeeManageActions, ResetBudgetButton } from "./employee-forms";

export const metadata: Metadata = { title: "Mitarbeiter" };

export default async function EmployeesPage() {
  const user = await requireUser("ADMIN");
  const [employees, branches, pool] = await Promise.all([
    listEmployees(user), listBranches(user), poolOverview(user),
  ]);
  return (
    <>
      <PageHeader title="Mitarbeiter" subtitle="Stammdaten, Personalakte, Lohnauszahlung – Login nur für Außendienst mit Budget" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Section flush>
          {employees.length === 0 ? <Empty title="Noch keine Mitarbeiter">Lege rechts den ersten Mitarbeiter an (Login optional).</Empty> : (
            <ul className="divide-y divide-line">
              {employees.map((e) => (
                <li key={e.id} className="space-y-3 px-4 py-4 md:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/admin/employees/${e.id}`} className="min-w-0 flex-1 hover:underline">
                      <span className="flex flex-wrap items-center gap-2 font-medium">
                        {e.name}
                        {!e.isActive && <Pill tone="red">deaktiviert</Pill>}
                        {e.canLogin === false && <Pill tone="amber">ohne Login</Pill>}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        {e.canLogin === false || e.email.includes("@no-login.local")
                          ? "Kein Login"
                          : `${e.email} – zuletzt ${fmtDateTime(e.lastLoginAt)}`}
                      </span>
                    </Link>
                    <span className="text-right">
                      <span className="block text-xs text-muted">Budget / Auslage</span>
                      <Money cents={e.balanceCents} className="font-semibold" />
                      {e.claimCents ? <span className="block text-xs text-muted">Anspruch {formatCents(e.claimCents)}</span> : null}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ResetBudgetButton id={e.id} balanceCents={e.balanceCents} />
                    <EmployeeManageActions
                      id={e.id} name={e.name} isActive={e.isActive}
                      cashCents={pool.cashBalanceCents} bankCents={pool.bankBalanceCents}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Neuer Mitarbeiter"><CreateEmployeeForm branches={branches} /></Section>
      </div>
    </>
  );
}
