import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listInvoices } from "@/application/invoices/drafts";
import { listIncomingBills } from "@/application/incoming-bills";
import { listBranches } from "@/application/branches/branches";
import { ButtonLink, cx, Empty, Money, PageHeader, Section, StatusBadge, Table, td } from "@/components/ui";
import { BillList, BillStatusFilters } from "@/components/bill-list";
import { BillUpload } from "@/components/bill-upload";
import { fmtDate, todayKey } from "@/domain/period";
import type { DisplayStatus } from "@/domain/invoice";
import type { BillStatus } from "@/domain/incoming-bill";

export const metadata: Metadata = { title: "Rechnungen" };

const FILTERS: { key?: DisplayStatus; label: string }[] = [
  { label: "Alle" }, { key: "DRAFT", label: "Entwürfe" }, { key: "OPEN", label: "Offen" },
  { key: "OVERDUE", label: "Überfällig" }, { key: "PAID", label: "Bezahlt" }, { key: "CANCELED", label: "Storniert" },
];

const TABS = [
  { key: "out" as const, href: "/admin/invoices", label: "Ausgangsrechnungen" },
  { key: "in" as const, href: "/admin/invoices?tab=in", label: "Eingangsrechnungen & Belege" },
];

export default async function InvoicesPage({ searchParams }: {
  searchParams: Promise<{ status?: string; q?: string; tab?: string; bill?: string }>;
}) {
  const user = await requireUser("ADMIN");
  const sp = await searchParams;
  const tab = sp.tab === "in" ? "in" : "out";
  const q = sp.q?.slice(0, 100);

  return (
    <>
      <PageHeader
        title={tab === "in" ? "Eingangsrechnungen & Belege" : "Rechnungen"}
        subtitle={tab === "in"
          ? "Lieferantenrechnung oder Quittung hochladen: Zahlungskanal (Bar oder Bank) und Filiale wählen, OCR-Vorschlag prüfen, mit einem Klick bestätigen."
          : "Kundenrechnungen schreiben, versenden und den Zahlungseingang verfolgen."}
        actions={tab === "out" ? <ButtonLink href="/admin/invoices/new" variant="primary">Neue Rechnung</ButtonLink> : undefined}
      />
      <div className="mb-4 flex flex-wrap gap-2 border-b border-line pb-3">
        {TABS.map((t) => (
          <Link key={t.key} href={t.href}
            className={cx("rounded-full px-4 py-1.5 text-sm font-semibold",
              tab === t.key ? "bg-ledger text-white" : "bg-paper text-muted hover:text-ink")}>
            {t.label}
          </Link>
        ))}
      </div>
      {tab === "in"
        ? <IncomingTab user={user} q={q} bill={sp.bill} />
        : <OutgoingTab user={user} q={q} status={FILTERS.find((f) => f.key === sp.status)?.key} />}
    </>
  );
}

async function OutgoingTab({ user, q, status }: { user: Awaited<ReturnType<typeof requireUser>>; q?: string; status?: DisplayStatus }) {
  const invoices = await listInvoices(user, { status, q });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link key={f.label} href={f.key ? `/admin/invoices?status=${f.key}` : "/admin/invoices"}
            className={cx("rounded-full border px-3 py-1.5 text-sm font-medium",
              status === f.key ? "border-ledger bg-ledger text-white" : "border-line bg-surface text-muted hover:text-ink")}>
            {f.label}
          </Link>
        ))}
        <form className="ms-auto w-full sm:w-64">
          {status && <input type="hidden" name="status" value={status} />}
          <input name="q" defaultValue={q} placeholder="Nummer oder Kunde suchen"
            className="h-10 w-full rounded-full border border-line bg-surface px-4 text-sm focus:border-ledger focus:outline-none" />
        </form>
      </div>
      <Section flush>
        {invoices.length === 0 ? (
          <Empty title={status || q ? "Keine passenden Rechnungen" : "Noch keine Rechnungen"}>
            {!status && !q && <Link href="/admin/invoices/new" className="text-ledger hover:underline">Erste Rechnung schreiben</Link>}
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

async function IncomingTab({ user, q, bill }: { user: Awaited<ReturnType<typeof requireUser>>; q?: string; bill?: string }) {
  const status = bill === "OPEN" || bill === "PAID" || bill === "CREDIT" ? bill as BillStatus : undefined;
  const [bills, branches] = await Promise.all([
    listIncomingBills(user, { q, status }),
    listBranches(user, { activeOnly: true }),
  ]);
  const tabHref = q ? `/admin/invoices?tab=in&q=${encodeURIComponent(q)}` : "/admin/invoices?tab=in";
  return (
    <>
      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,28rem)_1fr]">
        <Section title="Rechnung oder Quittung hochladen">
          <BillUpload today={todayKey()} branches={branches} />
        </Section>
        <Section title="So wird gebucht">
          <ul className="list-disc space-y-2 ps-5 text-sm text-muted">
            <li>Das System liest Lieferant und Endbetrag per OCR – Sie prüfen und übernehmen den Vorschlag.</li>
            <li>Pflicht: <strong className="text-ink">Wie wurde diese Rechnung bezahlt?</strong> Bar (Kasse) oder Karte/Überweisung (Bankkonto) – oder noch nicht bezahlt.</li>
            <li>Filiale wählen (Frankfurt, Wiesbaden, Offenbach, Hamburg, Eschborn …) und mit einem Klick bestätigen.</li>
            <li>Danach steht unübersehbar: <strong className="text-ink">wo</strong> gebucht wurde und ob die Rechnung <strong className="text-ink">offen, komplett bezahlt</strong> oder ein <strong className="text-ink">Guthaben</strong> hat.</li>
            <li>Gebuchte Beträge lassen sich wie gewohnt löschen, stornieren oder im Betrag ändern. Gleiche Datei wird nicht doppelt übernommen; Kasse und Bank bleiben getrennt.</li>
          </ul>
        </Section>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <BillStatusFilters current={status} tabHref={tabHref} />
        <form className="ms-auto w-full sm:w-72">
          <input type="hidden" name="tab" value="in" />
          {status && <input type="hidden" name="bill" value={status} />}
          <input name="q" defaultValue={q} placeholder="Lieferant, Kategorie, Lohn, Gastronomie …"
            className="h-10 w-full rounded-full border border-line bg-surface px-4 text-sm focus:border-ledger focus:outline-none" />
        </form>
      </div>
      <Section flush>
        <BillList bills={bills} branches={branches} emptyTitle={q || status ? "Keine passenden Eingangsrechnungen" : undefined} />
      </Section>
    </>
  );
}
