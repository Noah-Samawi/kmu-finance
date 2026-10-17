"use client";

import { useEffect, useMemo, useState } from "react";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, FUND_LABEL, type ExpenseFund } from "@/domain/cash";
import { REASON_MIN_WITHOUT_RECEIPT } from "@/domain/partner";
import { formatCents, parseEuroToCents } from "@/domain/money";
import { fmtDate } from "@/domain/period";

export interface PersonOption { id: string; name: string; role: "EMPLOYEE" | "PARTNER"; isActive?: boolean }

function cents(v: string): number | null {
  if (!v.trim()) return null;
  try {
    const c = parseEuroToCents(v);
    return Number.isInteger(c) ? c : null;
  } catch {
    return null;
  }
}

const EXPENSE_CHANNEL: Record<Exclude<ExpenseFund, "CAPITAL">, string> = {
  CASH: "Ausgaben Kasse (Bar)",
  BANK: "Ausgaben Bankkonto",
  BUDGET: `Aus ${FUND_LABEL.BUDGET}`,
};

const dateLabel = (day: string) => fmtDate(new Date(`${day}T12:00:00Z`));

/** Optionales Dropdown "Person zuordnen" – bei fester Person nur ein verstecktes Feld */
export function PersonSelect({ persons, preset, required, label }: {
  persons: PersonOption[]; preset?: PersonOption | null; required?: boolean; label?: string;
}) {
  if (preset) return <input type="hidden" name="personId" value={preset.id} />;
  const employees = persons.filter((p) => p.role === "EMPLOYEE" && p.isActive !== false);
  const partners = persons.filter((p) => p.role === "PARTNER" && p.isActive !== false);
  return (
    <Field label={label ?? "Person zuordnen (Mitarbeiter / Partner / Gesellschafter)"} hint={required ? undefined : "Optional – verknüpft die Buchung mit dem Personenkonto und Einzelbericht"}>
      <select name="personId" defaultValue="" required={required} className={inputCls}>
        <option value="">{required ? "Bitte wählen …" : "– keine Person –"}</option>
        {employees.length > 0 && (
          <optgroup label="Mitarbeiter">
            {employees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
        )}
        {partners.length > 0 && (
          <optgroup label="Partner & Gesellschafter">
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
        )}
      </select>
    </Field>
  );
}

interface AccountDay { count: number; cents: number; warning: string | null }
interface DayInfo { cash: AccountDay; bank: AccountDay }

/** Bereits gebuchte Tageseinnahmen des Datums – getrennt je Konto */
function useDayIncomes(date: string, tick: number) {
  const [info, setInfo] = useState<DayInfo | null>(null);
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setInfo(null);
    let off = false;
    fetch(`/api/v1/cash/day?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: DayInfo | null) => { if (!off) setInfo(d); })
      .catch(() => { if (!off) setInfo(null); });
    return () => { off = true; };
  }, [date, tick]);
  return info;
}

/**
 * Rote Erinnerung nur, wenn auf DASSELBE Konto erneut gebucht wird (2× Kasse oder 2× Bank).
 * 1× Kasse + 1× Bank am selben Tag ist normal und zeigt keine Warnung. Buchung bleibt immer möglich.
 */
export function DuplicateWarning({ account, day }: { account: "CASH" | "BANK"; day: AccountDay }) {
  if (!day.warning) return null;
  const n = day.count;
  return (
    <div role="alert" className="rounded-lg border-2 border-minus bg-minus-soft px-3 py-2 text-sm text-minus">
      <p className="font-semibold">{day.warning}</p>
      <p className="mt-0.5">
        {`Bereits gebucht auf ${account === "CASH" ? "Kasse (Bar)" : "Bankkonto"}: ${n} Einnahme${n === 1 ? "" : "n"}, ${formatCents(day.cents)} – Buchung trotzdem möglich.`}
      </p>
    </div>
  );
}

/**
 * Tageseinnahme: Kasse (Bar) und Bankkonto für ein Datum in einem Schritt –
 * gebucht werden zwei getrennte Einnahmen auf zwei getrennte Konten (nie zusammengerechnet).
 */
export function DailyIncomeForm({ today, persons, preset }: { today: string; persons: PersonOption[]; preset?: PersonOption | null }) {
  const { call, busy, error, setError } = useApi();
  const [date, setDate] = useState(today);
  const [cash, setCash] = useState("");
  const [bank, setBank] = useState("");
  const [tick, setTick] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const info = useDayIncomes(date, tick);
  const hasCash = !!cents(cash), hasBank = !!cents(bank);

  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setDone(null);
      if ((cash && cents(cash) === null) || (bank && cents(bank) === null)) return setError("Ungültiger Betrag");
      if (!hasCash && !hasBank) return setError("Bitte Betrag für Kasse (Bar) und/oder Bankkonto eingeben");
      const form = e.currentTarget;
      const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
      const r = await call<{ cashCents: number; bankCents: number }>("POST", "/api/v1/cash/income", {
        bookingDate: date, cashCents: cash || null, bankCents: bank || null, description: f.description, personId: f.personId || null,
      });
      if (r) {
        setDone([
          `Gebucht am ${dateLabel(date)}:`,
          r.cashCents ? `Tageseinnahme Kasse (Bar) +${formatCents(r.cashCents)}` : null,
          r.bankCents ? `Tageseinnahme Bankkonto +${formatCents(r.bankCents)}` : null,
        ].filter(Boolean).join(" "));
        setCash(""); setBank("");
        (form.elements.namedItem("description") as HTMLInputElement).value = "";
        setTick((t) => t + 1);
      }
    }}>
      <Field label="Datum">
        <input type="date" value={date} max={today} required onChange={(e) => setDate(e.target.value)} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tageseinnahme Kasse (Bar)" hint={info?.cash.count ? `Bereits gebucht: ${formatCents(info.cash.cents)}` : undefined}>
          <input value={cash} onChange={(e) => setCash(e.target.value)} inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} />
        </Field>
        <Field label="Tageseinnahme Bankkonto" hint={info?.bank.count ? `Bereits gebucht: ${formatCents(info.bank.cents)}` : undefined}>
          <input value={bank} onChange={(e) => setBank(e.target.value)} inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} />
        </Field>
      </div>
      {info && hasCash && <DuplicateWarning account="CASH" day={info.cash} />}
      {info && hasBank && <DuplicateWarning account="BANK" day={info.bank} />}
      <Field label="Wofür?"><input name="description" required minLength={2} defaultValue="Tageseinnahme" className={inputCls} dir="auto" /></Field>
      <PersonSelect persons={persons} preset={preset} />
      <ErrorNote error={error} />
      {done && <p className="text-sm font-medium text-ledger">{done}</p>}
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>
        {hasCash && hasBank ? "Kasse und Bank getrennt buchen" : hasBank ? "Auf Bankkonto buchen" : "In Kasse (Bar) buchen"}
      </button>
    </form>
  );
}

/** Gastro-Ausgabe: Wareneinkauf / Betriebskosten mit Herkunftskonto, Kategorie und Beleg oder Begründung */
export function ExpenseForm({ today, persons, preset, funds = ["CASH", "BANK"], balances = {} }: {
  today: string; persons: PersonOption[]; preset?: PersonOption | null;
  funds?: Exclude<ExpenseFund, "CAPITAL">[]; balances?: Partial<Record<ExpenseFund, number>>;
}) {
  const { call, busy, error, setError } = useApi();
  const [fund, setFund] = useState(funds[0]);
  const [hasFile, setHasFile] = useState(false);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      const file = fd.get("file") as File | null;
      if (!file || !file.size) fd.delete("file");
      const purpose = String(fd.get("purpose") ?? "").trim();
      if (!fd.has("file") && purpose.length < REASON_MIN_WITHOUT_RECEIPT) {
        return setError(`Ohne Beleg ist eine Begründung Pflicht (mindestens ${REASON_MIN_WITHOUT_RECEIPT} Zeichen)`);
      }
      fd.set("fund", fund);
      if (await call("POST", "/api/v1/cash/expenses", fd)) { form.reset(); setHasFile(false); }
    }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ausgabenkanal (Herkunftskonto)">
          <select value={fund} onChange={(e) => setFund(e.target.value as typeof fund)} className={inputCls}>
            {funds.map((f) => (
              <option key={f} value={f}>{EXPENSE_CHANNEL[f]}{balances[f] != null ? ` · Bestand ${formatCents(balances[f]!)}` : ""}</option>
            ))}
          </select>
        </Field>
        <Field label="Kategorie">
          <select name="category" required defaultValue="WAREN" className={inputCls}>
            {EXPENSE_CATEGORY_KEYS.map((k) => <option key={k} value={k}>{EXPENSE_CATEGORIES[k]}</option>)}
          </select>
        </Field>
        <Field label="Betrag"><input name="amount" required inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} /></Field>
        <Field label="Datum"><input name="bookingDate" type="date" max={today} defaultValue={today} className={inputCls} /></Field>
      </div>
      <Field label={hasFile ? "Wofür?" : `Wofür? / Begründung (ohne Beleg mind. ${REASON_MIN_WITHOUT_RECEIPT} Zeichen)`}>
        <input name="purpose" required minLength={3} placeholder="z. B. Metro – Fleisch und Gemüse" className={inputCls} dir="auto" />
      </Field>
      <Field label="Beleg (Foto oder PDF)" hint="Optional – ohne Beleg ist die Begründung Pflicht">
        <input name="file" type="file" accept="image/*,application/pdf" onChange={(e) => setHasFile(!!e.target.files?.length)} className="block w-full text-sm" />
      </Field>
      {fund === "BUDGET" && !preset
        ? <PersonSelect persons={persons.filter((p) => p.role === "EMPLOYEE")} required label="Aus dem Budget von" />
        : <PersonSelect persons={persons} preset={preset} />}
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>Ausgabe buchen</button>
    </form>
  );
}

interface BalanceInfo { balanceCents: number; currentCents: number }

/** Bestandskorrektur: Stichtag wählen → Buchbestand wird geladen → Ist-Bestand + Begründung → Differenzbuchung */
export function BalanceCorrectionForm({ today }: { today: string }) {
  const { call, busy, error, setError } = useApi();
  const [account, setAccount] = useState<"CASH" | "BANK">("CASH");
  const [date, setDate] = useState(today);
  const [actual, setActual] = useState("");
  const [tick, setTick] = useState(0);
  const [book, setBook] = useState<BalanceInfo | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setBook(null);
    let off = false;
    setBook(null);
    fetch(`/api/v1/cash/balance?date=${date}&account=${account}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BalanceInfo | null) => { if (!off) setBook(d); })
      .catch(() => { if (!off) setBook(null); });
    return () => { off = true; };
  }, [date, account, tick]);

  const actualCents = cents(actual);
  const diff = useMemo(() => (book && actualCents !== null ? actualCents - book.balanceCents : null), [book, actualCents]);

  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setDone(null);
      if (actualCents === null || actualCents < 0) return setError("Bitte gezählten Ist-Bestand eingeben");
      const form = e.currentTarget;
      const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
      const r = await call<{ diffCents: number }>("POST", "/api/v1/cash/correction", {
        accountKind: account, date, actualCents: actual, description: f.description,
      });
      if (r) {
        setDone(`Korrektur gebucht: Differenz ${r.diffCents > 0 ? "+" : ""}${formatCents(r.diffCents)}`);
        setActual("");
        (form.elements.namedItem("description") as HTMLTextAreaElement).value = "";
        setTick((t) => t + 1);
      }
    }}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Konto">
          <select value={account} onChange={(e) => setAccount(e.target.value as "CASH" | "BANK")} className={inputCls}>
            <option value="CASH">Kasse (Bar)</option>
            <option value="BANK">Bankkonto</option>
          </select>
        </Field>
        <Field label="Stichtag">
          <input type="date" value={date} max={today} required onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <div className="rounded-lg border border-line bg-paper px-3 py-2 text-sm">
        <p className="flex justify-between"><span className="text-muted">Buchbestand Ende {dateLabel(date)}</span>
          <strong className="tabular">{book ? formatCents(book.balanceCents) : "…"}</strong></p>
        {book && date !== today && <p className="flex justify-between text-xs text-muted"><span>Aktueller Bestand</span><span className="tabular">{formatCents(book.currentCents)}</span></p>}
      </div>
      <Field label="Neuer Ist-Stand (gezählt)">
        <input value={actual} onChange={(e) => setActual(e.target.value)} required inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} />
      </Field>
      {diff !== null && (
        <p className={cx("flex justify-between text-sm font-medium", diff === 0 ? "text-muted" : diff > 0 ? "text-ledger" : "text-minus")}>
          <span>Differenzkorrektur</span><span className="tabular">{diff > 0 ? "+" : ""}{formatCents(diff)}</span>
        </p>
      )}
      <Field label="Begründung (Pflicht, mind. 10 Zeichen)">
        <textarea name="description" required minLength={10} rows={2} placeholder="z. B. Kassensturz Abend: Zählung weicht ab" className={inputCls} dir="auto" />
      </Field>
      <ErrorNote error={error} />
      {done && <p className="text-sm font-medium text-ledger">{done}</p>}
      <button disabled={busy || diff === 0} className={cx(btn.base, btn.secondary, "w-full")}>Differenz GoBD-konform buchen</button>
    </form>
  );
}
