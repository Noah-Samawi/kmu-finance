import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getInvoice } from "@/application/invoices/drafts";
import { listContacts } from "@/application/contacts/contacts";
import { getOwnTenant } from "@/application/tenants/tenants";
import { Money, PageHeader, Section, StatusBadge, Table, td } from "@/components/ui";
import { vatBreakdown } from "@/domain/invoice";
import { formatCents, formatVatRate } from "@/domain/money";
import { fmtDate, todayKey } from "@/domain/period";
import { InvoiceEditor } from "../invoice-editor";
import { InvoiceActions } from "./invoice-actions";

export const metadata: Metadata = { title: "Rechnung" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("ADMIN");
  const { id } = await params;
  const inv = await getInvoice(user, id);

  if (inv.status === "DRAFT") {
    const [contacts, tenant] = await Promise.all([listContacts(user), getOwnTenant(user)]);
    return (
      <>
        <PageHeader title="Rechnungsentwurf" subtitle={`Für ${inv.contact.name}`}
          actions={<InvoiceActions id={inv.id} status={inv.status} isCancellation={false} today={todayKey()} />} />
        <InvoiceEditor
          contacts={contacts.map((c) => ({ id: c.id, name: c.name }))}
          smallBusiness={tenant.smallBusiness}
          initial={{
            id: inv.id, contactId: inv.contactId, notes: inv.notes ?? "",
            serviceDate: inv.serviceDate ? todayKey(inv.serviceDate) : "",
            dueDate: inv.dueDate ? todayKey(inv.dueDate) : "",
            items: inv.items,
          }}
        />
      </>
    );
  }

  const snap = inv.recipientSnapshot as { recipient: { name: string; street: string | null; zip: string | null; city: string | null } } | null;
  const r = snap?.recipient ?? inv.contact;
  return (
    <>
      <PageHeader
        title={inv.cancelsInvoiceId ? `Stornorechnung ${inv.number}` : `Rechnung ${inv.number}`}
        subtitle={<span className="inline-flex items-center gap-2"><StatusBadge status={inv.displayStatus} /> {inv.contact.name}</span>}
        actions={<InvoiceActions id={inv.id} status={inv.status} isCancellation={!!inv.cancelsInvoiceId} today={todayKey()} />}
      />

      {inv.canceledBy && (
        <p className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          Storniert durch <Link className="font-medium text-ledger hover:underline" href={`/admin/invoices/${inv.canceledBy.id}`}>{inv.canceledBy.number}</Link>.
        </p>
      )}
      {inv.cancels && (
        <p className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          Storniert die Rechnung <Link className="font-medium text-ledger hover:underline" href={`/admin/invoices/${inv.cancels.id}`}>{inv.cancels.number}</Link>.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Section flush>
          <Table head={["Pos.", "Beschreibung", "Menge", "Einzelpreis", "USt.", <span key="n" className="block text-right">Netto</span>]}>
            {inv.items.map((i) => (
              <tr key={i.id}>
                <td className={td + " text-muted"}>{i.position}</td>
                <td className={td}>{i.description}</td>
                <td className={td + " tabular"}>{Number(i.quantity).toLocaleString("de-DE")} {i.unit}</td>
                <td className={td + " tabular"}>{formatCents(i.unitPriceCents)}</td>
                <td className={td}>{formatVatRate(i.vatRate)}</td>
                <td className={td + " text-right"}><Money cents={i.lineNetCents} /></td>
              </tr>
            ))}
          </Table>
          <dl className="ml-auto max-w-xs space-y-1 border-t border-line px-4 py-4 text-sm md:px-5">
            <div className="flex justify-between"><dt className="text-muted">Netto</dt><dd><Money cents={inv.netCents} /></dd></div>
            {vatBreakdown(inv.items).filter((v) => v.rate > 0).map((v) => (
              <div key={v.rate} className="flex justify-between"><dt className="text-muted">USt. {formatVatRate(v.rate)}</dt><dd><Money cents={v.vat} /></dd></div>
            ))}
            <div className="flex justify-between border-t border-line pt-1 text-base font-semibold"><dt>Gesamt</dt><dd><Money cents={inv.grossCents} /></dd></div>
          </dl>
          {inv.notes && <p className="border-t border-line px-4 py-3 text-sm text-muted md:px-5">{inv.notes}</p>}
        </Section>

        <Section title="Details">
          <dl className="space-y-3 text-sm">
            <div><dt className="text-muted">Empfänger</dt><dd className="font-medium">{r.name}</dd>
              <dd className="text-muted">{[r.street, [r.zip, r.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</dd></div>
            <div><dt className="text-muted">Rechnungsdatum</dt><dd>{fmtDate(inv.issueDate)}</dd></div>
            <div><dt className="text-muted">Leistungsdatum</dt><dd>{fmtDate(inv.serviceDate)}</dd></div>
            {!inv.cancelsInvoiceId && <div><dt className="text-muted">Fällig am</dt><dd>{fmtDate(inv.dueDate)}</dd></div>}
            {inv.paidAt && <div><dt className="text-muted">Bezahlt am</dt><dd>{fmtDate(inv.paidAt)}</dd></div>}
            {inv.incomeEntryId && <div><dt className="text-muted">Einnahmen-Pool</dt><dd className="text-ledger">Betrag wurde dem Kassenbestand gutgeschrieben</dd></div>}
          </dl>
        </Section>
      </div>
    </>
  );
}
