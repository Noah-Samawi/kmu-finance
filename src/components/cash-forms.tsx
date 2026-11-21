"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { EXPENSE_CATEGORIES, FUND_LABEL, type ExpenseFund } from "@/domain/cash";
import type { ScanResult } from "@/domain/ocr";
import { ReceiptCapture } from "./receipt-capture";
import { BranchSelect, CategoryField, type BranchOption } from "./branch-category";
import { PartnerRoleField, VatFields } from "./vat-fields";
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
export function PersonSelect({ persons, preset, required, label, value, onChange }: {
  persons: PersonOption[]; preset?: PersonOption | null; required?: boolean; label?: string;
  value?: string; onChange?: (id: string) => void;
}) {
  if (preset) return <input type="hidden" name="personId" value={preset.id} />;
  const employees = persons.filter((p) => p.role === "EMPLOYEE" && p.isActive !== false);
  const partners = persons.filter((p) => p.role === "PARTNER" && p.isActive !== false);
  const ctrl = value !== undefined
    ? { value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange?.(e.target.value) }
    : { defaultValue: "" };
  return (
    <Field label={label ?? "Person zuordnen (Mitarbeiter / Partner / Gesellschafter)"} hint={required ? undefined : "Optional – verknüpft die Buchung mit dem Personenkonto und Einzelbericht"}>
      <select name="personId" required={required} className={inputCls} {...ctrl}>
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
 * Tageseinnahme: Kasse/Bank × 7 % / 19 % MwSt. gleichzeitig (Brutto-Beträge).
 * Jede Zelle wird als eigene Buchung mit dem jeweiligen Satz erfasst.
 */
export function DailyIncomeForm({ today, branches }: {
  today: string; branches?: BranchOption[];
}) {
  const { call, busy, error, setError } = useApi();
  const [date, setDate] = useState(today);
  const [cash7, setCash7] = useState("");
  const [cash19, setCash19] = useState("");
  const [bank7, setBank7] = useState("");
  const [bank19, setBank19] = useState("");
  const [vatMode, setVatMode] = useState<"GROSS" | "NET">("GROSS");
  const [tick, setTick] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const info = useDayIncomes(date, tick);

  const values = [cash7, cash19, bank7, bank19];
  const parsed = values.map(cents);
  const hasAny = parsed.some((c) => !!c);
  const hasCash = !!(parsed[0] || parsed[1]);
  const hasBank = !!(parsed[2] || parsed[3]);

  function resetAmounts() {
    setCash7(""); setCash19(""); setBank7(""); setBank19("");
  }

  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setDone(null);
      if (values.some((v) => v && cents(v) === null)) return setError("Ungültiger Betrag");
      if (!hasAny) return setError("Bitte Beträge für 7 % und/oder 19 % MwSt. eingeben");
      const form = e.currentTarget;
      const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
      const r = await call<{ cashCents: number; bankCents: number }>("POST", "/api/v1/cash/income", {
        bookingDate: date,
        cash7Cents: cash7 || null,
        cash19Cents: cash19 || null,
        bank7Cents: bank7 || null,
        bank19Cents: bank19 || null,
        description: f.description,
        branchId: f.branchId || null,
        vatMode,
      });
      if (r) {
        setDone([
          `Gebucht am ${dateLabel(date)}:`,
          r.cashCents ? `Kasse (Bar) +${formatCents(r.cashCents)}` : null,
          r.bankCents ? `Bankkonto +${formatCents(r.bankCents)}` : null,
        ].filter(Boolean).join(" "));
        resetAmounts();
        (form.elements.namedItem("description") as HTMLInputElement).value = "";
        setTick((t) => t + 1);
      }
    }}>
      <Field label="Datum">
        <input type="date" value={date} max={today} required onChange={(e) => setDate(e.target.value)} className={inputCls} />
      </Field>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[320px] text-sm">
          <thead>
            <tr className="border-b border-line bg-paper text-left text-muted">
              <th className="px-3 py-2 font-medium">Konto</th>
              <th className="px-3 py-2 font-medium">7 % MwSt.</th>
              <th className="px-3 py-2 font-medium">19 % MwSt.</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <td className="px-3 py-2 align-middle font-medium">
                Kasse (Bar)
                {info?.cash.count ? <span className="mt-0.5 block text-xs font-normal text-muted">bereits {formatCents(info.cash.cents)}</span> : null}
              </td>
              <td className="px-2 py-2">
                <input value={cash7} onChange={(e) => setCash7(e.target.value)} inputMode="decimal" placeholder="0,00"
                  aria-label="Kasse 7 Prozent" className={cx(inputCls, "text-right tabular")} />
              </td>
              <td className="px-2 py-2">
                <input value={cash19} onChange={(e) => setCash19(e.target.value)} inputMode="decimal" placeholder="0,00"
                  aria-label="Kasse 19 Prozent" className={cx(inputCls, "text-right tabular")} />
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2 align-middle font-medium">
                Bankkonto
                {info?.bank.count ? <span className="mt-0.5 block text-xs font-normal text-muted">bereits {formatCents(info.bank.cents)}</span> : null}
              </td>
              <td className="px-2 py-2">
                <input value={bank7} onChange={(e) => setBank7(e.target.value)} inputMode="decimal" placeholder="0,00"
                  aria-label="Bank 7 Prozent" className={cx(inputCls, "text-right tabular")} />
              </td>
              <td className="px-2 py-2">
                <input value={bank19} onChange={(e) => setBank19(e.target.value)} inputMode="decimal" placeholder="0,00"
                  aria-label="Bank 19 Prozent" className={cx(inputCls, "text-right tabular")} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {info && hasCash && <DuplicateWarning account="CASH" day={info.cash} />}
      {info && hasBank && <DuplicateWarning account="BANK" day={info.bank} />}

      <Field label="Betragsart">
        <select value={vatMode} onChange={(e) => setVatMode(e.target.value as "GROSS" | "NET")} className={inputCls}>
          <option value="GROSS">Brutto inkl. MwSt.</option>
          <option value="NET">Netto zzgl. MwSt.</option>
        </select>
      </Field>
      <p className="text-xs text-muted">
        7 % und 19 % gleichzeitig möglich. Kasse/Bank buchen den Zahlungsbetrag; die MwSt. wird je Satz getrennt gebucht.
      </p>

      <Field label="Wofür?"><input name="description" required minLength={2} defaultValue="Tageseinnahme" className={inputCls} dir="auto" /></Field>
      <BranchSelect branches={branches} />
      <ErrorNote error={error} />
      {done && <p className="text-sm font-medium text-ledger">{done}</p>}
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>
        {hasCash && hasBank ? "Kasse und Bank buchen" : hasBank ? "Auf Bankkonto buchen" : "In Kasse (Bar) buchen"}
      </button>
    </form>
  );
}

const centsToInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");

/**
 * Gastro-Ausgabe: Wareneinkauf / Betriebskosten mit Herkunftskonto, Kategorie, Filiale und Beleg.
 * Beleg per Kamera oder Datei → KI liest Datum, Händler, Betrag, Kategorie und füllt das Formular aus;
 * das Foto wird mit der Buchung gespeichert. initialFile: Scan wurde schon außerhalb gestartet (z. B. "Belege prüfen").
 */
export function ExpenseForm({ today, persons, preset, funds = ["CASH", "BANK"], balances = {}, branches, initialFile, onBooked }: {
  today: string; persons: PersonOption[]; preset?: PersonOption | null;
  funds?: Exclude<ExpenseFund, "CAPITAL">[]; balances?: Partial<Record<ExpenseFund, number>>; branches?: BranchOption[];
  initialFile?: File | null; onBooked?: () => void;
}) {
  const { call, busy, error, setError } = useApi();
  const [fund, setFund] = useState(funds[0]);
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState("WAREN");
  const [personId, setPersonId] = useState(preset?.id ?? "");
  const [partnerRole, setPartnerRole] = useState<"" | "FIRMA" | "PRIVAT">("");
  const [vatRate, setVatRate] = useState(0);
  const autoPurpose = useRef("");
  const started = useRef(false);
  const [ocr, setOcr] = useState<{ busy: boolean; hint: (ScanResult & { text: string }) | null; error: string | null }>(
    { busy: false, hint: null, error: null },
  );
  const selected = persons.find((p) => p.id === personId);
  const isPartner = selected?.role === "PARTNER";

  /** Erkannte Werte direkt eintragen – der Nutzer gleicht nur noch mit dem Foto ab */
  function fill(h: ScanResult) {
    if (h.amountCents) setAmount(centsToInput(h.amountCents));
    if (h.date && h.date <= today) setDate(h.date);
    if (h.vatRate) setVatRate(h.vatRate);
    const cat = h.customCategory ?? h.category;
    if (cat) setCategory(cat);
    const text = h.merchant ? (h.description ? `${h.merchant} – ${h.description}` : `${h.merchant} – Einkauf`) : h.description ?? "";
    if (text) {
      // eigene Eingaben nicht überschreiben; frühere automatische Texte schon
      setPurpose((p) => (!p.trim() || p === autoPurpose.current ? text : p));
      autoPurpose.current = text;
    }
  }

  async function analyse(f: File) {
    setOcr({ busy: true, hint: null, error: null });
    try {
      const { recognizeReceipt } = await import("./ocr");
      const hint = await recognizeReceipt(f);
      const found = !!(hint.amountCents || hint.merchant);
      if (found) fill(hint);
      setOcr({
        busy: false, hint,
        error: !found ? "Kein Betrag erkannt – bitte manuell erfassen"
          : hint.source === "local" ? "Die KI-Erkennung war nicht erreichbar – einfache Texterkennung verwendet. Bitte genau prüfen." : null,
      });
    } catch {
      setOcr({ busy: false, hint: null, error: "Belegerkennung nicht möglich – bitte manuell erfassen" });
    }
  }

  function onFile(f: File | null) {
    setFile(f);
    setError(null);
    if (f) analyse(f); else setOcr({ busy: false, hint: null, error: null });
  }

  useEffect(() => {
    if (initialFile && !started.current) { started.current = true; onFile(initialFile); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      if (file) fd.set("file", file); else fd.delete("file");
      if (!file && purpose.trim().length < REASON_MIN_WITHOUT_RECEIPT) {
        return setError(`Ohne Beleg ist eine Begründung Pflicht (mindestens ${REASON_MIN_WITHOUT_RECEIPT} Zeichen)`);
      }
      if (isPartner && !partnerRole) return setError("Bitte Art der Gesellschafter-Buchung wählen");
      fd.set("fund", fund);
      fd.set("personId", personId);
      if (partnerRole) fd.set("partnerRole", partnerRole); else fd.delete("partnerRole");
      if (await call("POST", "/api/v1/cash/expenses", fd)) {
        form.reset(); setFile(null); setAmount(""); setPurpose(""); setDate(today); setCategory("WAREN");
        setPersonId(preset?.id ?? ""); setPartnerRole(""); setVatRate(0); autoPurpose.current = "";
        setOcr({ busy: false, hint: null, error: null });
        onBooked?.();
      }
    }}>
      <ReceiptCapture file={file} onFile={onFile} onError={setError} analysing={ocr.busy} />
      {ocr.error && <p className="text-sm text-amber-700">{ocr.error}</p>}
      {ocr.hint && (ocr.hint.amountCents || ocr.hint.merchant) && !ocr.busy && (
        <div className="rounded-lg border border-ledger/30 bg-ledger-soft px-3 py-2 text-sm">
          <p className="font-medium">Beleg erkannt – bitte mit dem Foto abgleichen</p>
          <p className="text-muted">
            {[
              ocr.hint.merchant && `Händler: ${ocr.hint.merchant}`,
              ocr.hint.amountCents && `Betrag: ${formatCents(ocr.hint.amountCents)}`,
              ocr.hint.date && `Datum: ${dateLabel(ocr.hint.date)}`,
              ocr.hint.vatRate && `MwSt ${ocr.hint.vatRate / 100} %${ocr.hint.vatAmountCents ? ` (${formatCents(ocr.hint.vatAmountCents)})` : ""}`,
              (ocr.hint.customCategory || ocr.hint.category) && `Kategorie: ${ocr.hint.customCategory ?? EXPENSE_CATEGORIES[ocr.hint.category!]}`,
              ocr.hint.payment && `Hinweis Zahlung: ${ocr.hint.payment === "CASH" ? "vermutlich Bar" : "vermutlich Karte"} – bitte selbst wählen`,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
      )}
      <fieldset className="rounded-lg border-2 border-ink/20 bg-paper p-3">
        <legend className="px-1 text-sm font-semibold">Wie wurde diese Rechnung bezahlt?</legend>
        <p className="mb-2 text-xs text-muted">Pflicht – Bar geht auf die Kasse, Karte/Überweisung auf das Bankkonto. Es wird nichts stillschweigend zugeordnet.</p>
        <div className="space-y-2">
          {funds.map((f) => (
            <label key={f} className={cx(
              "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2",
              fund === f ? "border-ledger bg-ledger-soft" : "border-line bg-surface hover:border-ink/30",
            )}>
              <input type="radio" name="fundRadio" className="mt-1 accent-[var(--color-ledger)]" checked={fund === f} onChange={() => setFund(f)} />
              <span>
                <span className="block text-sm font-medium">{f === "CASH" ? "Bar (Kasse)" : f === "BANK" ? "Karte / Überweisung (Bankkonto)" : EXPENSE_CHANNEL[f]}</span>
                <span className="block text-xs text-muted">
                  {EXPENSE_CHANNEL[f]}{balances[f] != null ? ` · Bestand ${formatCents(balances[f]!)}` : ""}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <CategoryField value={category} onChange={setCategory} />
        <Field label="Betrag"><input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} required inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} /></Field>
        <Field label="Datum"><input name="bookingDate" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
      </div>
      <VatFields amount={amount} defaultRate={vatRate} key={vatRate} />
      <Field label={file ? "Wofür?" : `Wofür? / Begründung (ohne Beleg mind. ${REASON_MIN_WITHOUT_RECEIPT} Zeichen)`}>
        <input name="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} required minLength={3} placeholder="z. B. Metro – Fleisch und Gemüse" className={inputCls} dir="auto" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {fund === "BUDGET" && !preset
          ? <PersonSelect persons={persons.filter((p) => p.role === "EMPLOYEE")} required label="Aus dem Budget von"
              value={personId} onChange={(id) => { setPersonId(id); setPartnerRole(""); }} />
          : <PersonSelect persons={persons} preset={preset} value={personId}
              onChange={(id) => { setPersonId(id); setPartnerRole(""); }} />}
        <BranchSelect branches={branches} />
      </div>
      <PartnerRoleField show={isPartner} value={partnerRole} onChange={setPartnerRole} />
      <ErrorNote error={error} />
      <button disabled={busy || ocr.busy} className={cx(btn.base, btn.primary, "w-full")}>{ocr.busy ? "Beleg wird analysiert …" : "Speichern / Buchen"}</button>
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
