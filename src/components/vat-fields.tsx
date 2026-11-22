"use client";

import { useMemo, useState } from "react";
import { VatSelect } from "@/components/vat-select";
import { Field, cx, inputCls } from "@/components/ui";
import { formatCents, parseEuroToCents } from "@/domain/money";
import { splitVat, type VatMode } from "@/domain/vat-booking";

/** MwSt.-Satz + Brutto/Netto; zeigt Netto, MwSt. und Brutto live an */
export function VatFields({
  amount, defaultRate = 0, defaultMode = "GROSS", onRate, onMode, namePrefix = "",
}: {
  amount: string;
  defaultRate?: number;
  defaultMode?: VatMode;
  onRate?: (bp: number) => void;
  onMode?: (m: VatMode) => void;
  namePrefix?: string;
}) {
  const [rate, setRate] = useState(defaultRate);
  const [mode, setMode] = useState<VatMode>(defaultMode);

  const split = useMemo(() => {
    try {
      const cents = amount.trim() ? parseEuroToCents(amount) : 0;
      if (cents <= 0) return null;
      return splitVat(cents, rate, mode);
    } catch { return null; }
  }, [amount, rate, mode]);

  return (
    <div className="space-y-2 rounded-lg border border-line bg-paper p-3">
      <p className="text-sm font-medium">Mehrwertsteuer</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Satz (0–20 %)">
          <VatSelect name={`${namePrefix}vatRate`} value={rate} onChange={(bp) => { setRate(bp); onRate?.(bp); }} />
        </Field>
        <Field label="Betragsart">
          <select name={`${namePrefix}vatMode`} value={mode} className={inputCls}
            onChange={(e) => { const m = e.target.value as VatMode; setMode(m); onMode?.(m); }}>
            <option value="GROSS">Brutto inkl. MwSt.</option>
            <option value="NET">Netto zzgl. MwSt.</option>
          </select>
        </Field>
      </div>
      {split && rate > 0 && (
        <dl className="grid grid-cols-3 gap-2 text-sm tabular">
          <div><dt className="text-xs text-muted">Netto</dt><dd className="font-medium">{formatCents(split.netCents)}</dd></div>
          <div><dt className="text-xs text-muted">MwSt. {rate / 100} %</dt><dd className="font-medium">{formatCents(split.vatCents)}</dd></div>
          <div><dt className="text-xs text-muted">Brutto (Zahlung)</dt><dd className={cx("font-semibold")}>{formatCents(split.grossCents)}</dd></div>
        </dl>
      )}
      <p className="text-xs text-muted">Kasse und Bank buchen den Brutto-Zahlungsbetrag. Die MwSt. wird im MwSt.-Konto getrennt geführt.</p>
    </div>
  );
}

export type PartnerExpenseRole = "FIRMA" | "PRIVAT" | "GEWINN" | "LOHN";

/** Art der Zuordnung – Pflicht bei Gesellschafter; bei Mitarbeiter optional Lohn */
export function PartnerRoleField({ show, value, onChange, mode = "partner" }: {
  show: boolean; value: "" | PartnerExpenseRole; onChange: (v: "" | PartnerExpenseRole) => void;
  mode?: "partner" | "employee";
}) {
  if (!show) return null;
  const options = mode === "employee"
    ? ([
      ["LOHN", "Lohn", "Kasse/Bank −; als Lohn auf dem Personenkonto ausgewiesen."],
    ] as const)
    : ([
      ["FIRMA", "Firmenausgabe / Betriebsausgabe", "Kasse/Bank −; Spalte Betriebsausgaben (Kapital unverändert)."],
      ["GEWINN", "Gewinnanteil-Auszahlung", "Kasse/Bank −; Spalte Gewinnanteil (Kapitalkonto unverändert)."],
      ["PRIVAT", "Kapitalrückzahlung / Entnahme", "Kasse/Bank − und Kapitalkonto − (Richtung Null)."],
      ["LOHN", "Lohn", "Kasse/Bank −; Spalte Lohn (Kapital unverändert)."],
    ] as const);
  return (
    <fieldset className="rounded-lg border-2 border-ink/20 bg-paper p-3">
      <legend className="px-1 text-sm font-semibold">
        {mode === "employee" ? "Als Lohn buchen? (optional)" : "Art der Gesellschafter-Buchung"}
      </legend>
      <p className="mb-2 text-xs text-muted">
        {mode === "employee"
          ? "Leer lassen = normale Zuordnung. „Lohn“ = Auszahlung erscheint in der Lohn-Spalte."
          : "Pflicht – Kasse/Bank wird belastet; die Spalte oben richtet sich nach der Art."}
      </p>
      <div className="space-y-2">
        {mode === "employee" && (
          <label className={cx(
            "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2",
            value === "" ? "border-ledger bg-ledger-soft" : "border-line bg-surface hover:border-ink/30",
          )}>
            <input type="radio" name="partnerRole" value="" className="mt-1 accent-[var(--color-ledger)]"
              checked={value === ""} onChange={() => onChange("")} />
            <span>
              <span className="block text-sm font-medium">Keine Lohn-Buchung</span>
              <span className="block text-xs text-muted">Ausgabe nur zuordnen, ohne Lohn-Spalte.</span>
            </span>
          </label>
        )}
        {options.map(([v, title, hint]) => (
          <label key={v} className={cx(
            "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2",
            value === v ? "border-ledger bg-ledger-soft" : "border-line bg-surface hover:border-ink/30",
          )}>
            <input type="radio" name="partnerRole" value={v} className="mt-1 accent-[var(--color-ledger)]"
              checked={value === v} onChange={() => onChange(v)} required={mode === "partner"} />
            <span>
              <span className="block text-sm font-medium">{title}</span>
              <span className="block text-xs text-muted">{hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
