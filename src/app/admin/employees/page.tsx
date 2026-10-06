import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listEmployees } from "@/application/employees/employees";
import { Empty, Money, PageHeader, Pill, Section } from "@/components/ui";
import { fmtDateTime } from "@/domain/period";
import { CreateEmployeeForm } from "./employee-forms";

export const metadata: Metadata = { title: "Mitarbeiter" };

export default async function EmployeesPage() {
  const user = await requireUser("ADMIN");
  const employees = await listEmployees(user);
  return (
    <>
      <PageHeader title="Mitarbeiter" subtitle="Einkäufer und Fahrer mit eigenem Budget-Konto" />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Section flush>
          {employees.length === 0 ? <Empty title="Noch keine Mitarbeiter">Lege rechts den ersten Zugang an.</Empty> : (
            <ul className="divide-y divide-line">
              {employees.map((e) => (
                <li key={e.id}>
                  <Link href={`/admin/employees/${e.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper md:px-5">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium">{e.name}{!e.isActive && <Pill tone="red">gesperrt</Pill>}</span>
                      <span className="block truncate text-sm text-muted">{e.email} – zuletzt angemeldet {fmtDateTime(e.lastLoginAt)}</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-xs text-muted">Guthaben</span>
                      <Money cents={e.balanceCents} className="font-semibold" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Neuer Mitarbeiter"><CreateEmployeeForm /></Section>
      </div>
    </>
  );
}
