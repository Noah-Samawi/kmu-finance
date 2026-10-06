import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getContact } from "@/application/contacts/contacts";
import { ButtonLink, Empty, Money, PageHeader, Section, StatusBadge, Table, td } from "@/components/ui";
import { formatCents } from "@/domain/money";
import { fmtDate } from "@/domain/period";
import { ContactForm } from "../contact-form";

export const metadata: Metadata = { title: "Kontakt" };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("ADMIN");
  const { id } = await params;
  const { contact, invoices, stats } = await getContact(user, id);
  return (
    <>
      <PageHeader title={contact.name}
        subtitle={<>Offen {formatCents(stats.openCents)}, bezahlt {formatCents(stats.paidCents)}{stats.overdueCount > 0 && <span className="text-amber">, {stats.overdueCount} überfällig</span>}</>}
        actions={!contact.archived && <ButtonLink href={`/admin/invoices/new?contactId=${contact.id}`} variant="primary">Rechnung schreiben</ButtonLink>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Section title="Rechnungsverlauf" flush>
          {invoices.length === 0 ? <Empty title="Noch keine Rechnungen an diesen Kontakt" /> : (
            <Table head={["Nummer", "Datum", "Fällig", "Status", <span key="b" className="block text-right">Betrag</span>]}>
              {invoices.map((i) => (
                <tr key={i.id} className="hover:bg-paper">
                  <td className={td}><Link className="font-medium text-ledger hover:underline" href={`/admin/invoices/${i.id}`}>{i.number ?? "Entwurf"}</Link></td>
                  <td className={td + " text-muted"}>{fmtDate(i.issueDate)}</td>
                  <td className={td + " text-muted"}>{i.status === "OPEN" ? fmtDate(i.dueDate) : "–"}</td>
                  <td className={td}><StatusBadge status={i.displayStatus} /></td>
                  <td className={td + " text-right"}><Money cents={i.grossCents} /></td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
        <Section title="Stammdaten"><ContactForm contact={contact} /></Section>
      </div>
    </>
  );
}
