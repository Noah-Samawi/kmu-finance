import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listReceipts } from "@/application/receipts/receipts";
import { cx, Empty, Money, PageHeader, Pill, Section } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/domain/period";
import { ReviewButtons } from "./review-buttons";

export const metadata: Metadata = { title: "Belege prüfen" };

const TABS = [
  { key: "SUBMITTED", label: "Zu prüfen" },
  { key: "APPROVED", label: "Geprüft" },
  { key: "REJECTED", label: "Abgelehnt" },
] as const;

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser("ADMIN");
  const sp = await searchParams;
  const status = TABS.find((t) => t.key === sp.status)?.key ?? "SUBMITTED";
  const receipts = await listReceipts(user, { status });

  return (
    <>
      <PageHeader title="Belege prüfen" subtitle="Belege sind beim Einreichen schon vom Guthaben abgezogen. Ablehnen bucht den Betrag zurück." />
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/receipts?status=${t.key}`}
            className={cx("rounded-full border px-3 py-1.5 text-sm font-medium", status === t.key ? "border-ledger bg-ledger text-white" : "border-line bg-surface text-muted hover:text-ink")}>
            {t.label}
          </Link>
        ))}
      </div>
      {receipts.length === 0 ? (
        <Section><Empty title={status === "SUBMITTED" ? "Alles geprüft" : "Keine Belege in dieser Ansicht"} /></Section>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {receipts.map((r) => (
            <li key={r.id} className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
              <a href={`/api/v1/receipts/${r.id}/file`} target="_blank" className="block aspect-[4/3] bg-paper">
                {r.fileMime.startsWith("image/") && !r.fileMime.includes("hei") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/v1/receipts/${r.id}/file`} alt={`Beleg ${r.merchant}`} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-sm font-medium text-ledger">Datei öffnen</span>
                )}
              </a>
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{r.merchant}</p>
                    <p className="truncate text-sm text-muted">{r.employeeName} – Bon vom {fmtDate(r.receiptDate)}</p>
                  </div>
                  <Money cents={r.amountCents} className="text-lg font-semibold" />
                </div>
                {r.description && <p className="text-sm">{r.description}</p>}
                {r.status === "REJECTED" && <p className="text-sm text-minus">Abgelehnt: {r.rejectReason}</p>}
                <p className="text-xs text-muted">Eingereicht {fmtDateTime(r.createdAt)}{r.status === "APPROVED" && <> {" "}<Pill tone="green">geprüft</Pill></>}</p>
                <div className="mt-auto"><ReviewButtons id={r.id} status={r.status} /></div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
