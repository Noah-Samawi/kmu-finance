"use client";

import { useState } from "react";
import { btn, cx, Field, inputCls, Pill } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { EXPENSE_CATEGORIES } from "@/domain/cash";
import type { ReceiptSuggestion } from "@/domain/ocr";
import { PAY_KIND_LABEL, type BillPayKind } from "@/domain/incoming-bill";
import { formatCents } from "@/domain/money";
import { fmtDate } from "@/domain/period";
import { BranchSelect, CategoryField, type BranchOption } from "./branch-category";

const centsToInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const dateLabel = (d: string) => { try { return fmtDate(new Date(d + "T12:00:00")); } catch { return d; } };

const PAY_OPTIONS: { value: BillPayKind; title: string; hint: string }[] = [
  { value: "CASH", title: "Bar (Kasse)", hint: "Wird als Ausgabe Kasse (Bar) gebucht" },
  { value: "BANK", title: "Karte / Überweisung (Bankkonto)", hint: "Wird als Ausgabe Bankkonto gebucht" },
  { value: "UNPAID", title: "Noch nicht bezahlt", hint: "Rechnung bleibt offen – keine Buchung auf Kasse oder Bank" },
];

export interface BillBooked {
  id: string; supplier: string; amountCents: number; paidCents: number;
  statusLabel: string; bookedLabel: string; status: "OPEN" | "PAID" | "CREDIT";
  warnings?: string[];
}

/** Rechnung / Quittung hochladen: OCR liest Lieferant und Betrag, Admin wählt Zahlungskanal + Filiale und bestätigt. */
export function BillUpload({ today, branches, compact }: { today: string; branches?: BranchOption[]; compact?: boolean }) {
  const { call, busy, error, setError } = useApi();
  const [file, setFile] = useState<File | null>(null);
  const [fileTick, setFileTick] = useState(0);
  const [payKind, setPayKind] = useState<BillPayKind | "">("");
  const [supplier, setSupplier] = useState("");
  const [amount, setAmount] = useState("");
  const [paid, setPaid] = useState("");
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState("WAREN");
  const [purpose, setPurpose] = useState("");
  const [ocr, setOcr] = useState<{ busy: boolean; progress: number; hint: (ReceiptSuggestion & { text: string }) | null; error: string | null }>(
    { busy: false, progress: 0, hint: null, error: null },
  );
  const [done, setDone] = useState<BillBooked | null>(null);

  async function analyse(f: File) {
    setOcr({ busy: true, progress: 0, hint: null, error: null });
    try {
      const { recognizeReceipt } = await import("./ocr");
      const hint = await recognizeReceipt(f, (p) => setOcr((o) => ({ ...o, progress: p })));
      setOcr({ busy: false, progress: 1, hint, error: hint.amountCents || hint.merchant ? null : "Kein Betrag erkannt – bitte manuell erfassen" });
    } catch {
      setOcr({ busy: false, progress: 0, hint: null, error: "Belegerkennung nicht möglich – bitte manuell erfassen" });
    }
  }

  function apply(h: ReceiptSuggestion) {
    if (h.amountCents) {
      setAmount(centsToInput(h.amountCents));
      if (payKind !== "UNPAID") setPaid(centsToInput(h.amountCents));
    }
    if (h.merchant) {
      setSupplier(h.merchant);
      setPurpose((p) => p.trim() ? p : (h.merchant ?? ""));
    }
    if (h.date && h.date <= today) setDate(h.date);
    if (h.category) setCategory(h.category);
  }

  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setDone(null);
      if (!file) return setError("Bitte Rechnung oder Quittung hochladen");
      if (!payKind) return setError("Bitte wählen, wie diese Rechnung bezahlt wurde (Bar, Karte/Überweisung oder noch nicht bezahlt)");
      const fd = new FormData(e.currentTarget);
      fd.set("file", file);
      fd.set("payKind", payKind);
      fd.set("supplier", supplier);
      fd.set("amount", amount);
      if (payKind !== "UNPAID" && paid.trim()) fd.set("paid", paid);
      else fd.delete("paid");
      const r = await call<{ bill: BillBooked }>("POST", "/api/v1/bills", fd);
      if (r?.bill) {
        setDone(r.bill);
        setFile(null); setFileTick((n) => n + 1); setPayKind(""); setSupplier(""); setAmount(""); setPaid(""); setDate(today);
        setCategory("WAREN"); setPurpose("");
        setOcr({ busy: false, progress: 0, hint: null, error: null });
      }
    }}>
      <Field label="Rechnung / Quittung (Foto oder PDF)" hint="Lieferant und Endbetrag werden automatisch gelesen – die Buchung erfolgt erst nach Ihrer Bestätigung">
        <input key={fileTick} name="file" type="file" accept="image/*,application/pdf" required className="block w-full text-sm" onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f); setDone(null);
          if (f) analyse(f); else setOcr({ busy: false, progress: 0, hint: null, error: null });
        }} />
      </Field>
      {ocr.busy && <p className="text-sm text-muted">{`Beleg wird gelesen … ${Math.round(ocr.progress * 100)} %`}</p>}
      {ocr.error && <p className="text-sm text-amber-700">{ocr.error}</p>}
      {ocr.hint && (ocr.hint.amountCents || ocr.hint.merchant) && (
        <div className="rounded-lg border border-ledger/30 bg-ledger-soft px-3 py-2 text-sm">
          <p className="font-medium">Vorschlag aus dem Beleg – bitte prüfen</p>
          <p className="text-muted">
            {[
              ocr.hint.merchant && `Lieferant: ${ocr.hint.merchant}`,
              ocr.hint.amountCents && `Endbetrag: ${formatCents(ocr.hint.amountCents)}`,
              ocr.hint.date && `Datum: ${dateLabel(ocr.hint.date)}`,
              ocr.hint.payment && `Hinweis Zahlung: ${ocr.hint.payment === "CASH" ? "vermutlich Bar" : "vermutlich Karte"} – bitte selbst wählen`,
              ocr.hint.category && `Kategorie: ${EXPENSE_CATEGORIES[ocr.hint.category]}`,
            ].filter(Boolean).join(" · ")}
          </p>
          <button type="button" onClick={() => apply(ocr.hint!)} className={cx(btn.base, btn.primary, btn.sm, "mt-2")}>Lieferant und Betrag übernehmen</button>
        </div>
      )}

      <fieldset className="rounded-lg border-2 border-ink/20 bg-paper p-3">
        <legend className="px-1 text-sm font-semibold">Wie wurde diese Rechnung bezahlt?</legend>
        <p className="mb-2 text-xs text-muted">Pflicht – das System bucht nie stillschweigend auf Kasse oder Bank.</p>
        <div className="space-y-2">
          {PAY_OPTIONS.map((o) => (
            <label key={o.value} className={cx(
              "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2",
              payKind === o.value ? "border-ledger bg-ledger-soft" : "border-line bg-surface hover:border-ink/30",
            )}>
              <input type="radio" name="payKindRadio" className="mt-1 accent-[var(--color-ledger)]" checked={payKind === o.value}
                onChange={() => {
                  setPayKind(o.value);
                  if (o.value === "UNPAID") setPaid("");
                  else if (!paid.trim() && amount) setPaid(amount);
                }} />
              <span>
                <span className="block text-sm font-medium">{o.title}</span>
                <span className="block text-xs text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Lieferant / Herkunft">
          <input name="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} required minLength={2}
            placeholder="z. B. Metro, Stadtwerke …" className={inputCls} dir="auto" />
        </Field>
        <CategoryField value={category} onChange={setCategory} />
        <Field label="Rechnungsbetrag (Endbetrag)">
          <input name="amount" value={amount} onChange={(e) => {
            setAmount(e.target.value);
            if (payKind !== "UNPAID" && (!paid || paid === amount)) setPaid(e.target.value);
          }} required inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} />
        </Field>
        <Field label="Datum"><input name="bookingDate" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
        {payKind && payKind !== "UNPAID" && (
          <Field label="Bereits gezahlt" hint="Leer = voller Rechnungsbetrag. Weniger = noch offen, mehr = Guthaben.">
            <input name="paid" value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="decimal" placeholder={amount || "0,00"} className={cx(inputCls, "text-right tabular")} />
          </Field>
        )}
        <BranchSelect branches={branches} required={!!branches?.length} label="Filiale" hint={branches?.length ? "Frankfurt, Wiesbaden, Offenbach, Hamburg, Eschborn …" : undefined} />
      </div>
      <Field label="Wofür? (optional)">
        <input name="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="z. B. Wareneinkauf KW 45" className={inputCls} dir="auto" />
      </Field>
      <ErrorNote error={error} />
      {done && (
        <div className="rounded-lg border border-ledger/40 bg-ledger-soft px-3 py-3 text-sm">
          <p className="font-semibold">{done.supplier} · {formatCents(done.amountCents)}</p>
          <p className="mt-1 flex flex-wrap gap-2">
            <Pill tone={done.bookedLabel.startsWith("Ausgabe") ? "green" : "amber"}>{done.bookedLabel}</Pill>
            <Pill tone={done.status === "PAID" ? "green" : done.status === "CREDIT" ? "amber" : "red"}>{done.statusLabel}</Pill>
          </p>
          {done.warnings?.map((w) => <p key={w} className="mt-1 text-amber-800">{w}</p>)}
        </div>
      )}
      <button disabled={busy || ocr.busy || !payKind} className={cx(btn.base, btn.primary, "w-full")}>
        {busy ? "Wird gebucht …" : compact ? "Buchung bestätigen" : `Buchung bestätigen${payKind ? ` · ${PAY_KIND_LABEL[payKind]}` : ""}`}
      </button>
    </form>
  );
}
