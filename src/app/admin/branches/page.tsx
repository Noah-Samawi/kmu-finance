import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { branchOverview, branchReport, listBranches } from "@/application/branches/branches";
import { listPersons } from "@/application/cash/cash";
import type { BranchFigures } from "@/domain/branch";
import { branchPdfUrl } from "@/domain/branch";
import { parseLedgerFilter } from "@/domain/ledger-filter";
import { formatCents } from "@/domain/money";
import { monthKey, todayKey } from "@/domain/period";
import { Empty, PageHeader, Section, cx } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { LedgerFilterBar } from "@/components/ledger-filter-bar";
import { BranchAdmin, BranchBookingsPanel, BranchDetailActions } from "./branch-forms";

export const metadata: Metadata = { title: "Filialen" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function BranchesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("ADMIN");
  const sp = await searchParams;
  const today = todayKey();
  const from = sp.from && DAY.test(sp.from) ? sp.from : `${monthKey()}-01`;
  const to = sp.to && DAY.test(sp.to) ? sp.to : today;
  const selected = sp.branch || null;
  const filter = { ...parseLedgerFilter(sp), branchId: undefined };
  const [branches, overview, persons] = await Promise.all([listBranches(user), branchOverview(user, from, to), listPersons(user)]);
  const detail = selected ? await branchReport(user, selected, from, to, filter) : null;
  const qs = (b: string) => `?${new URLSearchParams({ branch: b, from, to })}`;
  const selectedBranch = selected && selected !== "none" ? branches.find((b) => b.id === selected) ?? null : null;

  return (
    <>
      <PageHeader title="Filialen & Standorte"
        subtitle="Jede Buchung gehört zu einer Filiale oder zur zentralen Verwaltung. Berichte & Abschlüsse rechnen Kasse, Bank und GuV strikt je Standort – hier die Umsätze und Kosten im Überblick." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Section title={`Übersicht ${fmt(from)} – ${fmt(to)}`} flush>
            <form method="get" className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3 md:px-5">
              {selected && <input type="hidden" name="branch" value={selected} />}
              <label className="text-sm">Von <input type="date" name="from" defaultValue={from} className="ms-1 h-9 rounded-lg border border-line px-2" /></label>
              <label className="text-sm">Bis <input type="date" name="to" defaultValue={to} max={today} className="ms-1 h-9 rounded-lg border border-line px-2" /></label>
              <button className="h-9 rounded-lg bg-ledger px-3 text-sm font-semibold text-white">Anzeigen</button>
            </form>
            {overview.branches.length === 0 ? (
              <Empty title="Noch keine Filialen">Lege rechts Filialen an (z. B. Frankfurt, Wiesbaden, Offenbach, Hamburg, Eschborn).</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular">
                  <thead className="text-left text-xs text-muted">
                    <tr className="border-b border-line">
                      <th className="px-4 py-2 md:px-5">Filiale</th>
                      <th className="px-2 py-2 text-right">Umsatz Kasse (Bar)</th>
                      <th className="px-2 py-2 text-right">Umsatz Bank</th>
                      <th className="px-2 py-2 text-right">Kosten</th>
                      <th className="px-4 py-2 text-right md:px-5">Ergebnis</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {overview.branches.map((b) => (
                      <OverviewRow key={b.id} href={qs(b.id)} name={b.name} f={b.figures} active={selected === b.id}
                        inactive={!b.isActive} pdfHref={branchPdfUrl(b.id, from, to, "filialbericht")} />
                    ))}
                    <OverviewRow href={qs("none")} name="Ohne Filiale (zentral)" f={overview.unassigned} active={selected === "none"}
                      muted pdfHref={branchPdfUrl("none", from, to, "filialbericht")} />
                    <OverviewRow name="Gesamt" f={overview.total} strong />
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {detail && (
            <Section
              title={`${detail.branch?.name ?? "Ohne Filiale (zentral)"} – ${fmt(from)} bis ${fmt(to)}`}
              actions={<BranchDetailActions branch={selectedBranch} from={from} to={to} />}
              flush>
              <div className="grid gap-4 px-4 py-4 md:grid-cols-2 md:px-5">
                <dl className="space-y-1.5 rounded-lg bg-paper px-3 py-2 tabular">
                  <Line label="Umsatz Kasse (Bar)" cents={detail.figures.revenueCashCents} />
                  <Line label="Umsatz Bankkonto" cents={detail.figures.revenueBankCents} />
                  <Line label="Umsatz gesamt" cents={detail.figures.revenueCents} strong />
                  <Line label="Kosten aus Kasse (Bar)" cents={-detail.figures.costsCashCents} />
                  <Line label="Kosten vom Bankkonto" cents={-detail.figures.costsBankCents} />
                  {detail.figures.costsOtherCents !== 0 && <Line label="Kosten aus Budget / Kapital / Belegen" cents={-detail.figures.costsOtherCents} />}
                  <Line label="Ergebnis" cents={detail.figures.resultCents} strong />
                </dl>
                <div>
                  <p className="mb-1 text-sm font-medium">Kosten nach Kategorie</p>
                  {detail.figures.costsByCategory.length ? (
                    <dl className="space-y-1 tabular">
                      {detail.figures.costsByCategory.map((c) => <Line key={c.category} label={c.label} cents={c.cents} />)}
                    </dl>
                  ) : <p className="text-sm text-muted">Keine Kosten im Zeitraum.</p>}
                </div>
              </div>
              <BranchBookingsPanel title="Buchungen dieser Filiale im Zeitraum" count={detail.entries.length}>
                <LedgerFilterBar action="/admin/branches" filter={filter} from={from} to={to} persons={persons} hideBranch
                  hidden={{ branch: selected ?? undefined }} count={detail.entries.length} />
                <LedgerList rows={detail.entries.slice(0, 500)} mode="both" showEmployee admin branches={branches}
                  emptyTitle="Keine Buchungen für diese Filiale im Zeitraum" />
              </BranchBookingsPanel>
            </Section>
          )}
        </div>
        <Section title="Filialen verwalten"><BranchAdmin branches={branches} /></Section>
      </div>
    </>
  );
}

const fmt = (d: string) => d.split("-").reverse().join(".");

function OverviewRow({ href, name, f, active, inactive, muted, strong, pdfHref }: {
  href?: string; name: string; f: BranchFigures; active?: boolean; inactive?: boolean; muted?: boolean; strong?: boolean;
  pdfHref?: string;
}) {
  return (
    <tr className={cx(active && "bg-ledger-soft", strong && "border-t-2 border-ink font-semibold")}>
      <td className="px-4 py-2 md:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {href ? <Link href={href} className={cx("font-medium text-ledger hover:underline", muted && "text-muted")}>{name}</Link> : name}
          {inactive && <span className="text-xs text-muted">(inaktiv)</span>}
          {pdfHref && (
            <a href={pdfHref} className="inline-flex min-h-9 items-center text-sm font-medium text-ledger hover:underline">PDF</a>
          )}
        </div>
      </td>
      <td className="px-2 py-2 text-right">{formatCents(f.revenueCashCents)}</td>
      <td className="px-2 py-2 text-right">{formatCents(f.revenueBankCents)}</td>
      <td className="px-2 py-2 text-right">{formatCents(f.costsCents)}</td>
      <td className={cx("px-4 py-2 text-right md:px-5", f.resultCents < 0 && "text-minus")}>{formatCents(f.resultCents)}</td>
    </tr>
  );
}

function Line({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className={cx("flex items-baseline justify-between gap-4 text-[15px]", strong && "border-t border-line pt-1 font-semibold")}>
      <dt className={strong ? "" : "text-muted"}>{label}</dt><dd>{formatCents(cents)}</dd>
    </div>
  );
}
