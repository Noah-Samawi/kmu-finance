import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listInvoices } from "@/application/invoices/drafts";
import { ButtonLink, cx, Empty, Money, PageHeader, Section, StatusBadge, Table, td } from "@/components/ui";
import { fmtDate } from "@/domain/period";
import type { DisplayStatus } from "@/domain/invoice";

export const metadata: Metadata = { title: "Rechnungen" };

const FILTERS: { key?: DisplayStatus; label: string }[] = [
  { label: "Alle" }, { key: "DRAFT", label: "Entwürfe" }, { key: "OPEN", label: "Offen" },
  { key: "OVERDUE", label: "Überfällig" }, { key: "PAID", label: "Bezahlt" }, { key: "CANCELED", label: "Storniert" },
];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const user = await requireUser("ADMIN");
  const sp = await searchParams;
  const status = FILTERS.find((f) => f.key === sp.status)?.key;
  const invoices = await listInvoices(user, { status, q: sp.q?.slice(0, 100) });

  return (
    <>
      <PageHeader title="Rechnungen" actions={<ButtonLink href="/admin/invoices/new" variant="primary">Neue Rechnung</ButtonLink>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link key={f.label} href={f.key ? `/admin/invoices?status=${f.key}` : "/admin/invoices"}
            className={cx("rounded-full border px-3 py-1.5 text-sm font-medium",
              status === f.key ? "border-ledger bg-ledger text-white" : "border-line bg-surface text-muted hover:text-ink")}>
            {f.label}
          </Link>
        ))}
        <form className="ml-auto w-full sm:w-64">
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={sp.q} placeholder="Nummer oder Kunde suchen"
            className="h-10 w-full rounded-full border border-line bg-surface px-4 text-sm focus:border-ledger focus:outline-none" />
        </form>
      </div>
      <Section flush>
        {invoices.length === 0 ? (
          <Empty title={status || sp.q ? "Keine passenden Rechnungen" : "Noch keine Rechnungen"}>
            {!status && !sp.q && <Link href="/admin/invoices/new" className="text-ledger hover:underline">Erste Rechnung schreiben</Link>}
          </Empty>
        ) : (
          <Table head={["Nummer", "Kunde", "Datum", "Fällig", "Status", <span key="b" className="block text-right">Betrag</span>]}>
            {invoices.map((i) => (
              <tr key={i.id} className="hover:bg-paper">
                <td className={td}>
                  <Link href={`/admin/invoices/${i.id}`} className="font-medium text-ledger hover:underline">{i.number ?? "Entwurf"}</Link>
                  {i.cancelsInvoiceId && <span className="block text-xs text-muted">Stornorechnung</span>}
                </td>
                <td className={td}>{i.contactName}</td>
                <td className={td + " text-muted"}>{fmtDate(i.issueDate)}</td>
                <td className={td + " text-muted"}>{i.status === "OPEN" ? fmtDate(i.dueDate) : "–"}</td>
                <td className={td}><StatusBadge status={i.displayStatus} /></td>
                <td className={td + " text-right font-medium"}><Money cents={i.grossCents} /></td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </>
  );
}
