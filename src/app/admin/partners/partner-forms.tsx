"use client";

import { useMemo, useState } from "react";
import type { PartnerBookingRow } from "@/application/partners/partner-bookings";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { centsToPlain, formatCents, parseEuroToCents } from "@/domain/money";
import { fmtDate } from "@/domain/period";
import { ADMIN_KINDS, FUNDING_LABEL, PARTNER_KIND_LABEL, allowedSources, isPurchase, type FundingSource } from "@/domain/partner";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS } from "@/domain/cash";
import { DailyIncomeForm, ExpenseForm, type PersonOption } from "@/components/cash-forms";

interface Partner {
  id: string; name: string; isActive: boolean; canViewReports: boolean; canViewBank: boolean;
  capitalCents: number; outlayOpenCents: number; budgetCents: number; bookings: PartnerBookingRow[];
}

export function PartnerForms({ partner, today, cashCents, bankCents }: { partner?: Partner; today?: string; cashCents?: number; bankCents?: number }) {
  const { call, busy, error } = useApi();
  const [more, setMore] = useState<null | "income" | "expense">(null);
  if (!partner) {
    return (
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
        if (await call("POST", "/api/v1/partners", {
          name: f.name, email: f.email, password: f.password,
          canViewReports: f.canViewReports === "on", canViewBank: f.canViewBank === "on",
        })) form.reset();
      }}>
        <Field label="Name"><input name="name" required className={inputCls} /></Field>
        <Field label="E-Mail"><input name="email" type="email" required className={inputCls} /></Field>
        <Field label="Passwort"><input name="password" type="text" minLength={8} required className={inputCls} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="canViewReports" /> Berichte einsehen</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="canViewBank" /> Kontoauszüge einsehen</label>
        <ErrorNote error={error} />
        <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>Gesellschafter anlegen</button>
      </form>
    );
  }
  return (
    <div className="mt-3 space-y-4">
      <AdminBookingForm partner={partner} />
      <RefundForm partnerId={partner.id} bookings={partner.bookings} />
      <div className="rounded-lg border border-line p-3">
        <p className="text-sm font-medium">{`Über Kasse & Bank – ${partner.name} zuordnen`}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={cx(btn.base, btn.sm, more === "income" ? btn.primary : btn.secondary)} onClick={() => setMore(more === "income" ? null : "income")}>
            {`Einnahme über ${partner.name}`}
          </button>
          <button type="button" className={cx(btn.base, btn.sm, more === "expense" ? btn.primary : btn.secondary)} onClick={() => setMore(more === "expense" ? null : "expense")}>
            Ausgabe mit Firmenkasse / -bank
          </button>
        </div>
        {more && today && (
          <div className="mt-3">
            {more === "income"
              ? <DailyIncomeForm today={today} persons={[]} preset={asPerson(partner)} />
              : <ExpenseForm today={today} persons={[]} preset={asPerson(partner)} balances={{ CASH: cashCents, BANK: bankCents }} />}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} className={cx(btn.base, btn.secondary, btn.sm)}
          onClick={() => call("PATCH", `/api/v1/partners/${partner.id}`, { canViewReports: !partner.canViewReports })}>
          Berichte {partner.canViewReports ? "entziehen" : "geben"}
        </button>
        <button disabled={busy} className={cx(btn.base, btn.secondary, btn.sm)}
          onClick={() => call("PATCH", `/api/v1/partners/${partner.id}`, { canViewBank: !partner.canViewBank })}>
          Bank {partner.canViewBank ? "entziehen" : "geben"}
        </button>
        <button disabled={busy} className={cx(btn.base, btn.sm, partner.isActive ? btn.danger : btn.primary)}
          onClick={() => call("PATCH", `/api/v1/partners/${partner.id}`, { isActive: !partner.isActive })}>
          {partner.isActive ? "Sperren" : "Freischalten"}
        </button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

type AdminKind = (typeof ADMIN_KINDS)[number];

const asPerson = (p: Partner): PersonOption => ({ id: p.id, name: p.name, role: "PARTNER", isActive: p.isActive });

const KIND_GROUPS: { label: string; kinds: AdminKind[] }[] = [
  { label: "Einnahmen & Gutschriften", kinds: ["DEPOSIT", "PROFIT", "OUTLAY"] },
  { label: "Ausgaben / Einkäufe für die Firma", kinds: ["PURCHASE_CAPITAL", "PURCHASE_BUDGET"] },
  { label: "Budget / Vorschuss", kinds: ["BUDGET", "BUDGET_RETURN", "BUDGET_SETTLED"] },
  { label: "Entnahme", kinds: ["DRAW"] },
];

function AdminBookingForm({ partner }: { partner: Partner }) {
  const { call, busy, error } = useApi();
  const [kind, setKind] = useState<AdminKind>("DEPOSIT");
  const [amount, setAmount] = useState("");
  const sources = allowedSources(kind);
  const purchase = isPurchase(kind);
  const base = kind === "PURCHASE_CAPITAL" ? partner.capitalCents : partner.budgetCents;
  const amt = safeCents(amount);
  return (
    <form className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
      if (await call("POST", `/api/v1/partners/${partner.id}/book`, {
        kind, source: sources ? f.source : null, amountCents: amount, purpose: f.purpose,
        bookingDate: f.bookingDate || undefined, category: purchase ? f.category : undefined,
      })) { form.reset(); setAmount(""); }
    }}>
      <p className="text-sm font-medium sm:col-span-2">{`Buchung für ${partner.name}`}</p>
      <Field label="Vorgang">
        <select value={kind} onChange={(e) => setKind(e.target.value as AdminKind)} className={inputCls}>
          {KIND_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.kinds.map((k) => <option key={k} value={k}>{PARTNER_KIND_LABEL[k]}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      {purchase ? (
        <Field label="Kategorie">
          <select key={kind} name="category" required defaultValue="WAREN" className={inputCls}>
            {EXPENSE_CATEGORY_KEYS.map((k) => <option key={k} value={k}>{EXPENSE_CATEGORIES[k]}</option>)}
          </select>
        </Field>
      ) : (
        <Field label="Mittelherkunft / Konto">
          {sources ? (
            <select key={kind} name="source" required defaultValue="" className={inputCls}>
              <option value="" disabled>Bitte wählen …</option>
              {sources.map((s) => <option key={s} value={s}>{FUNDING_LABEL[s]}</option>)}
            </select>
          ) : <p className="py-2 text-sm text-muted">ohne Geldfluss</p>}
        </Field>
      )}
      <Field label="Betrag"><input value={amount} onChange={(e) => setAmount(e.target.value)} required inputMode="decimal" className={cx(inputCls, "text-right")} /></Field>
      <Field label="Datum"><input name="bookingDate" type="date" className={inputCls} /></Field>
      <Field label="Wofür? / Begründung" className="sm:col-span-2">
        <input name="purpose" required minLength={3} placeholder={purchase ? "z. B. Metro Fleischeinkauf" : undefined} className={inputCls} dir="auto" />
      </Field>
      {purchase && (
        <p className="rounded-lg bg-paper px-3 py-2 text-sm tabular sm:col-span-2">
          {kind === "PURCHASE_CAPITAL" ? "Kapitalkonto" : "Budget / Vorschuss"}: {formatCents(base)}
          {amt ? <> − {formatCents(amt)} = <strong className={base - amt < 0 ? "text-minus" : ""}>{formatCents(base - amt)} Restguthaben</strong></> : null}
          <span className="block text-xs text-muted">Wird sofort abgezogen und parallel als Betriebsausgabe (Wareneinkauf) im Hauptbuch gebucht.</span>
        </p>
      )}
      <p className="text-xs text-muted sm:col-span-2">
        Budget-Zuteilungen landen im Konto „Budget / Vorschuss“ und werden nie mit „Vorgelegtes Geld“ verrechnet.
        Offene Auslagen bitte ausschließlich über „Auslagen-Erstattung“ ausgleichen.
      </p>
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm, "sm:col-span-2")}>Buchen</button>
    </form>
  );
}

function RefundForm({ partnerId, bookings }: { partnerId: string; bookings: PartnerBookingRow[] }) {
  const { call, busy, error, setError } = useApi();
  const open = useMemo(() => bookings.filter((b) => b.openCents > 0), [bookings]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  if (!open.length) return null;

  const items = Object.entries(picked).map(([outlayId, v]) => ({ outlayId, amountCents: safeCents(v) }));
  const total = items.reduce((s, i) => s + (i.amountCents ?? 0), 0);

  return (
    <form className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/40 p-3" onSubmit={async (e) => {
      e.preventDefault();
      if (!items.length) return setError("Bitte mindestens eine offene Auslage auswählen");
      if (items.some((i) => i.amountCents === null)) return setError("Ungültiger Erstattungsbetrag");
      const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
      if (await call("POST", `/api/v1/partners/${partnerId}/refund`, {
        source: f.source, purpose: f.purpose, items,
      })) setPicked({});
    }}>
      <p className="text-sm font-medium">Auslagen-Erstattung – offene Auslagen gezielt auswählen</p>
      <ul className="space-y-1.5">
        {open.map((b) => {
          const on = b.id in picked;
          return (
            <li key={b.id} className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input type="checkbox" checked={on} onChange={(e) => setPicked((p) => {
                  const n = { ...p };
                  if (e.target.checked) n[b.id] = centsToPlain(b.openCents).replace(".", ",");
                  else delete n[b.id];
                  return n;
                })} />
                <span className="truncate" dir="auto">
                  {fmtDate(b.bookingDate)} · {b.purpose} · offen <strong className="tabular">{formatCents(b.openCents)}</strong>
                  {b.refundedCents > 0 && <span className="text-muted"> (von {formatCents(b.amountCents)})</span>}
                </span>
              </label>
              {on && (
                <input aria-label="Erstattungsbetrag" value={picked[b.id]} inputMode="decimal"
                  onChange={(e) => setPicked((p) => ({ ...p, [b.id]: e.target.value }))}
                  className={cx(inputCls, "w-28 py-1 text-right")} />
              )}
            </li>
          );
        })}
      </ul>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Auszahlung aus">
          <select name="source" required defaultValue="" className={inputCls}>
            <option value="" disabled>Bitte wählen …</option>
            {(["BANK", "CASH"] as FundingSource[]).map((s) => <option key={s} value={s}>{FUNDING_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Verwendungszweck">
          <input name="purpose" required minLength={3} defaultValue="Auslagen-Erstattung" className={inputCls} dir="auto" />
        </Field>
      </div>
      <ErrorNote error={error} />
      <button disabled={busy || !items.length} className={cx(btn.base, btn.primary, btn.sm, "w-full")}>
        Als Auslagen-Erstattung auszahlen{total ? ` (${formatCents(total)})` : ""}
      </button>
    </form>
  );
}

function safeCents(v: string): number | null {
  try {
    const c = parseEuroToCents(v);
    return Number.isInteger(c) && c > 0 ? c : null;
  } catch {
    return null;
  }
}
