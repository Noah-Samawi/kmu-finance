import Link from "next/link";
import type { FullBranchReport } from "@/application/reports/branch-report";
import { branchPdfUrl } from "@/domain/branch";
import { fmtDate } from "@/domain/period";
import { AccountFlowList } from "./account-flow";
import { LedgerList } from "./ledger-list";
import { Empty, Money, Section } from "./ui";

export function branchPdfHref(r: { branch: { id: string }; from: string; to: string }) {
  return branchPdfUrl(r.branch.id, r.from, r.to);
}

function Row({ label, cents, muted, strong }: { label: string; cents: number; muted?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "border-t border-line pt-1.5 font-semibold" : muted ? "text-muted" : ""}`}>
      <dt>{label}</dt>
      <dd><Money cents={cents} className={cents < 0 ? "text-minus" : ""} /></dd>
    </div>
  );
}

/** Einzelbericht einer Filiale: Kasse, Bank, Kostenstellen, Buchungen */
export function BranchReportView({ r }: { r: FullBranchReport }) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-surface p-4 md:p-5">
        <p className="text-sm text-muted">
          {r.branch.unassigned ? "Zentrale Verwaltung" : "Filiale"}
          {" · "}
          {fmtDate(new Date(r.from + "T12:00:00Z"))} – {fmtDate(new Date(r.to + "T12:00:00Z"))}
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {r.statements.map((s) => <li key={s}>• {s}</li>)}
        </ul>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Kasse (Bar)"><AccountFlowList account="CASH" flow={r.cash} /></Section>
        <Section title="Bankkonto"><AccountFlowList account="BANK" flow={r.bank} /></Section>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Ausgaben & Kostenstellen">
          <dl className="space-y-1.5 text-sm tabular">
            <Row label="Ausgaben Kasse (Bar)" cents={r.cash.expenseCents} muted />
            <Row label="Ausgaben Bankkonto" cents={r.bank.expenseCents} muted />
            {r.figures.costsByCategory.map((c) => (
              <Row key={c.category} label={c.label} cents={c.cents} />
            ))}
            <Row label="Gesamtausgaben der Filiale" cents={r.figures.costsCents} strong />
          </dl>
        </Section>
        <Section title="Gewinn & Verlust">
          <dl className="space-y-1.5 text-sm tabular">
            <Row label="Einnahmen (Tageseinnahmen + Rechnungen)" cents={r.figures.revenueCents} />
            <Row label="Ausgaben (Betriebsausgaben)" cents={r.figures.costsCents} />
            <Row label="Ergebnis / Gewinn dieser Filiale" cents={r.figures.resultCents} strong />
          </dl>
        </Section>
      </div>

      <Section title={`Einzelbuchungen (${r.entries.length})`} flush>
        {!r.entries.length
          ? <Empty title="Keine Buchungen dieser Filiale im Zeitraum" />
          : <LedgerList rows={r.entries} mode="both" showEmployee admin emptyTitle="Keine Buchungen dieser Filiale im Zeitraum" />}
      </Section>
    </div>
  );
}

/** Kompakte Karte je Filiale mit Link auf den eigenen Bericht – analog PersonReportCard */
export function BranchReportCard({ r, href }: { r: FullBranchReport; href: string }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{r.branch.name}</p>
          <p className="text-xs text-muted">{r.branch.unassigned ? "Zentrale Verwaltung" : "Filiale"}</p>
        </div>
        <a href={branchPdfHref(r)} className="text-sm font-medium text-ledger">PDF</a>
      </div>
      <dl className="mt-3 space-y-1 text-sm tabular">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Umsatz Kasse (Bar)</dt>
          <dd><Money cents={r.figures.revenueCashCents} /></dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Umsatz Bankkonto</dt>
          <dd><Money cents={r.figures.revenueBankCents} /></dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Gesamtausgaben der Filiale</dt>
          <dd><Money cents={r.figures.costsCents} /></dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Kassen-Endbestand</dt>
          <dd><Money cents={r.cash.closingCents} /></dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Bank-Endbestand</dt>
          <dd><Money cents={r.bank.closingCents} /></dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Ergebnis / Gewinn</dt>
          <dd><Money cents={r.figures.resultCents} className={r.figures.resultCents < 0 ? "text-minus" : ""} /></dd>
        </div>
      </dl>
      <Link href={href} className="mt-3 inline-block text-sm font-medium text-ledger">Einzelbericht öffnen →</Link>
    </section>
  );
}
