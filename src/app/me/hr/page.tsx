import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getPersonnelFile } from "@/application/hr/hr";
import { Section } from "@/components/ui";
import { formatCents } from "@/domain/money";

export const metadata: Metadata = { title: "Meine Unterlagen" };

export default async function MeHrPage() {
  const user = await requireUser("EMPLOYEE");
  const hr = await getPersonnelFile(user, user.userId);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Personalakte</h1>
      <Section title="Lohnabrechnungen">
        {hr.payslips.length === 0 ? <p className="text-sm text-muted">Noch keine Abrechnungen.</p> : (
          <ul className="divide-y divide-line text-sm">
            {hr.payslips.map((s) => (
              <li key={s.id} className="flex justify-between py-2">
                <span>{String(s.month).padStart(2, "0")}/{s.year} · Netto {formatCents(s.netCents)}</span>
                <a className="text-ledger" href={`/api/v1/employees/${user.userId}/payslips/${s.id}/pdf`}>PDF</a>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Unterlagen">
        {hr.documents.length === 0 ? <p className="text-sm text-muted">Noch keine Dateien.</p> : (
          <ul className="divide-y divide-line text-sm">
            {hr.documents.map((d) => (
              <li key={d.id} className="flex justify-between py-2">
                <span dir="auto">{d.title}</span>
                <a className="text-ledger" href={`/api/v1/employees/${user.userId}/hr/documents/${d.id}/file`}>Öffnen</a>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
