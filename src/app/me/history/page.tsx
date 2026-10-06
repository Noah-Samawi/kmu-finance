import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getSummary } from "@/application/reports/reports";
import { listReceipts } from "@/application/receipts/receipts";
import { btn, cx, Pill, Section } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { formatCents } from "@/domain/money";
import { monthKey, monthRange, todayKey } from "@/domain/period";

export const metadata: Metadata = { title: "Verlauf" };

function shiftMonth(m: string, by: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ m?: string; day?: string }> }) {
  const user = await requireUser("EMPLOYEE");
  const sp = await searchParams;
  const current = monthKey();
  const m = sp.m && /^\d{4}-\d{2}$/.test(sp.m) && sp.m <= current ? sp.m : current;
  const day = sp.day === "1";
  const today = todayKey();
  const from = day ? today : `${m}-01`;
  const to = day ? today : m === current ? today : todayKey(new Date(monthRange(m).end.getTime() - 1));
  const [{ summary, entries }, rejected] = await Promise.all([
    getSummary(user, from, to),
    listReceipts(user, { status: "REJECTED" }),
  ]);
  const e = summary.employees[0];
  const label = day ? "Heute" : new Date(`${m}-15T12:00:00Z`).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  return (
    <div className="space-y-5">
      <div className="flex rounded-full border border-line bg-surface p-1 text-sm font-medium">
        <Link href="/me/history?day=1" className={cx("flex-1 rounded-full py-2 text-center", day ? "bg-ledger text-white" : "text-muted")}>Tagesprotokoll</Link>
        <Link href="/me/history" className={cx("flex-1 rounded-full py-2 text-center", !day ? "bg-ledger text-white" : "text-muted")}>Monatsprotokoll</Link>
      </div>

      {!day && (
        <div className="flex items-center justify-between">
          <Link href={`/me/history?m=${shiftMonth(m, -1)}`} className={cx(btn.base, btn.ghost, btn.sm)} aria-label="Vormonat">‹</Link>
          <p className="font-semibold">{label}</p>
          {m < current ? <Link href={`/me/history?m=${shiftMonth(m, 1)}`} className={cx(btn.base, btn.ghost, btn.sm)} aria-label="Folgemonat">›</Link> : <span className="w-9" />}
        </div>
      )}

      {e && (
        <Section>
          <dl className="space-y-1.5 tabular">
            <Row label="Anfangsbestand" cents={e.openingCents} />
            <Row label="+ Erhalten" cents={e.allocatedCents} />
            <Row label="− Belege" cents={e.receiptsCents} />
            <Row label="− Ausgleich durch Chef" cents={e.adjustmentsCents} />
            <Row label="− Zurückgegeben" cents={e.returnedCents} />
            <div className="flex justify-between border-t border-ink/70 pt-1.5 font-semibold"><dt>Restbetrag</dt><dd>{formatCents(e.closingCents)}</dd></div>
          </dl>
          <a href={`/api/v1/reports/export?format=pdf&from=${from}&to=${to}`} className={cx(btn.base, btn.secondary, btn.sm, "mt-4 w-full")}>
            {label} als PDF
          </a>
        </Section>
      )}

      {rejected.length > 0 && (
        <Section title="Abgelehnte Belege">
          <ul className="space-y-2 text-sm">
            {rejected.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3">
                <span><span className="font-medium">{r.merchant}</span><span className="block text-muted">{r.rejectReason}</span></span>
                <Pill tone="red">{formatCents(r.amountCents)}</Pill>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Der Betrag wurde deinem Guthaben wieder gutgeschrieben.</p>
        </Section>
      )}

      <Section title="Buchungen" flush>
        <LedgerList rows={entries} mode="wallet" />
      </Section>
    </div>
  );
}

function Row({ label, cents }: { label: string; cents: number }) {
  return <div className="flex justify-between"><dt className="text-muted">{label}</dt><dd>{formatCents(cents)}</dd></div>;
}
