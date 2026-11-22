import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listReceipts } from "@/application/receipts/receipts";
import { listBelege, countBelegInbox } from "@/application/belege/belege";
import { listPersons } from "@/application/cash/cash";
import { listBranches } from "@/application/branches/branches";
import { poolOverview } from "@/application/pool/pool";
import { cx, Empty, Money, PageHeader, Pill, Section } from "@/components/ui";
import { fmtDate, fmtDateTime, todayKey } from "@/domain/period";
import { ReviewButtons } from "./review-buttons";
import { ScanLauncher } from "./scan-launcher";
import { BelegUpload } from "./beleg-upload";
import { BelegBoard } from "./beleg-board";
import { BelegReviewHost } from "./beleg-review-host";

export const metadata: Metadata = { title: "Belege prüfen" };

const TABS = [
  { key: "inbox", label: "Posteingang" },
  { key: "filed", label: "Belegablage" },
  { key: "all", label: "Alle Belege" },
  { key: "trash", label: "Papierkorb" },
  { key: "staff", label: "Mitarbeiter-Belege" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default async function ReceiptsPage({ searchParams }: {
  searchParams: Promise<{ tab?: string; status?: string; beleg?: string }>;
}) {
  const user = await requireUser("ADMIN");
  const sp = await searchParams;
  // Legacy ?status= → Mitarbeiter-Tab
  const tab: Tab = TABS.find((t) => t.key === sp.tab)?.key
    ?? (sp.status ? "staff" : "inbox");
  const staffStatus = (["SUBMITTED", "APPROVED", "REJECTED"] as const).find((k) => k === sp.status) ?? "SUBMITTED";

  const [inboxCount, belege, staffReceipts, persons, branches, pool] = await Promise.all([
    countBelegInbox(user),
    tab === "staff" ? Promise.resolve([]) : listBelege(user, {
      status: tab === "inbox" ? "INBOX" : tab === "filed" ? "FILED" : tab === "trash" ? "TRASH" : "ALL",
    }),
    tab === "staff" ? listReceipts(user, { status: staffStatus }) : Promise.resolve([]),
    listPersons(user),
    listBranches(user),
    poolOverview(user),
  ]);

  return (
    <>
      <PageHeader title="Belege prüfen"
        subtitle="DATEV-Prinzip: scannen → Posteingang → prüfen & buchen → Belegablage. Mitarbeiter-Belege (Budget) bleiben separat." />

      <BelegUpload branches={branches} />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/receipts?tab=${t.key}`}
            className={cx(
              "rounded-full border px-3 py-1.5 text-sm font-medium",
              tab === t.key ? "border-ledger bg-ledger text-white" : "border-line bg-surface text-muted hover:text-ink",
            )}>
            {t.label}
            {t.key === "inbox" && inboxCount > 0 && (
              <span className={cx("ml-1.5 rounded-full px-1.5 py-0.5 text-xs", tab === t.key ? "bg-white/20" : "bg-ledger-soft text-ink")}>
                {inboxCount}
              </span>
            )}
          </Link>
        ))}
      </div>

      {tab !== "staff" ? (
        <BelegBoard
          tab={tab === "all" ? "all" : tab}
          rows={belege as Parameters<typeof BelegBoard>[0]["rows"]}
          branches={branches}
          selectedId={sp.beleg}
        />
      ) : (
        <>
          <ScanLauncher today={todayKey()} persons={persons} branches={branches}
            balances={{ CASH: pool.cashBalanceCents, BANK: pool.bankBalanceCents }} />
          <div className="mb-4 flex gap-2">
            {([
              { key: "SUBMITTED", label: "Zu prüfen" },
              { key: "APPROVED", label: "Geprüft" },
              { key: "REJECTED", label: "Abgelehnt" },
            ] as const).map((t) => (
              <Link key={t.key} href={`/admin/receipts?tab=staff&status=${t.key}`}
                className={cx("rounded-full border px-3 py-1.5 text-sm font-medium",
                  staffStatus === t.key ? "border-ledger bg-ledger text-white" : "border-line bg-surface text-muted")}>
                {t.label}
              </Link>
            ))}
          </div>
          {staffReceipts.length === 0 ? (
            <Section><Empty title={staffStatus === "SUBMITTED" ? "Alles geprüft" : "Keine Belege"} /></Section>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {staffReceipts.map((r) => (
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
      )}

      {sp.beleg && tab !== "staff" && (
        <BelegReviewHost belegId={sp.beleg} branches={branches} today={todayKey()} />
      )}
    </>
  );
}
