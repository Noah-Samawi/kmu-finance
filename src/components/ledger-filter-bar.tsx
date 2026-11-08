import Link from "next/link";
import type { LedgerFilter } from "@/domain/ledger-filter";
import { btn, cx, inputCls } from "./ui";

interface Opt { id: string; name: string }

/** Such- und Filterleiste (GET-Formular, Filter stehen in der URL und lassen sich teilen/merken) */
export function LedgerFilterBar({ action, filter, from, to, branches = [], persons = [], hidden = {}, hideBranch, count }: {
  action: string; filter: LedgerFilter; from?: string; to?: string; branches?: Opt[]; persons?: (Opt & { role?: string })[];
  hidden?: Record<string, string | undefined>; hideBranch?: boolean; count?: number;
}) {
  const small = cx(inputCls, "h-9 text-sm");
  return (
    <form action={action} method="get" className="grid gap-2 border-b border-line px-4 py-3 md:grid-cols-[2fr_repeat(6,minmax(0,1fr))_auto] md:px-5" role="search">
      {Object.entries(hidden).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
      <input name="q" defaultValue={filter.q} placeholder="Suche: Begriff, Name, Kategorie, Betrag …" aria-label="Suchbegriff" className={small} />
      <input name="from" type="date" defaultValue={from} aria-label="Von" title="Von" className={small} />
      <input name="to" type="date" defaultValue={to} aria-label="Bis" title="Bis" className={small} />
      {hideBranch ? <span className="hidden md:block" /> : (
        <select name="branch" defaultValue={filter.branchId ?? ""} aria-label="Filiale" className={small}>
          <option value="">Alle Filialen</option>
          <option value="none">Ohne Filiale (zentral)</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      <select name="person" defaultValue={filter.personId ?? ""} aria-label="Person" className={small}>
        <option value="">Alle Personen</option>
        {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select name="account" defaultValue={filter.account ?? ""} aria-label="Konto" className={small}>
        <option value="">Kasse & Bank</option>
        <option value="CASH">Nur Kasse (Bar)</option>
        <option value="BANK">Nur Bankkonto</option>
      </select>
      <select name="kind" defaultValue={filter.kind ?? ""} aria-label="Art" className={small}>
        <option value="">Alle Arten</option>
        <option value="INCOME">Einnahmen</option>
        <option value="EXPENSE">Ausgaben</option>
        <option value="OTHER">Sonstige</option>
      </select>
      <div className="flex items-center gap-2">
        <button className={cx(btn.base, btn.primary, btn.sm)}>Filtern</button>
        <Link href={`${action}${Object.entries(hidden).some(([, v]) => v) ? `?${new URLSearchParams(Object.entries(hidden).filter(([, v]) => v) as [string, string][])}` : ""}`}
          className="text-sm text-muted hover:text-ink">Zurücksetzen</Link>
      </div>
      {count != null && <p className="text-xs text-muted md:col-span-8">{`${count} Buchung${count === 1 ? "" : "en"} gefunden`}</p>}
    </form>
  );
}
