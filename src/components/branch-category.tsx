"use client";

import { useState } from "react";
import { cx, Field, inputCls } from "./ui";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, isFixedCategory } from "@/domain/cash";

export interface BranchOption { id: string; name: string; city?: string | null; isActive?: boolean }

/** Filiale / Standort – erscheint nur, wenn Filialen angelegt sind */
export function BranchSelect({ branches, name = "branchId", value, onChange, defaultValue, label = "Filiale / Standort", hint, className, required }: {
  branches?: BranchOption[]; name?: string; value?: string; onChange?: (v: string) => void; defaultValue?: string | null;
  label?: string; hint?: string; className?: string; required?: boolean;
}) {
  const active = (branches ?? []).filter((b) => b.isActive !== false || b.id === (value ?? defaultValue));
  if (!active.length) return null;
  const ctrl = value !== undefined ? { value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange?.(e.target.value) } : { defaultValue: defaultValue ?? "" };
  return (
    <Field label={label} hint={hint} className={className}>
      <select name={name} required={required} {...ctrl} className={inputCls}>
        <option value="">{required ? "Bitte Filiale wählen …" : "– keine Filiale (zentral) –"}</option>
        {active.map((b) => <option key={b.id} value={b.id}>{b.name}{b.city && b.city !== b.name ? ` (${b.city})` : ""}</option>)}
      </select>
    </Field>
  );
}

const CUSTOM = "__custom";

/** Kategorie: feste Liste (inkl. "Lohn für Mitarbeiter") oder eigene Kategorie als Freitext */
export function CategoryField({ value, onChange, defaultValue = "WAREN", name = "category", label = "Kategorie" }: {
  value?: string; onChange?: (v: string) => void; defaultValue?: string; name?: string; label?: string;
}) {
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const set = (v: string) => (onChange ? onChange(v) : setInner(v));
  const [customMode, setCustomMode] = useState(!isFixedCategory(current));
  const custom = customMode || !isFixedCategory(current);
  return (
    <Field label={label} hint={custom ? "Eigene Kategorie, 2 bis 40 Zeichen" : undefined}>
      <div className={cx(custom && "flex gap-2")}>
        <select
          value={custom ? CUSTOM : current}
          onChange={(e) => {
            if (e.target.value === CUSTOM) { setCustomMode(true); set(""); } else { setCustomMode(false); set(e.target.value); }
          }}
          className={cx(inputCls, custom && "w-1/2")}
          aria-label={label}
        >
          {EXPENSE_CATEGORY_KEYS.map((k) => <option key={k} value={k}>{EXPENSE_CATEGORIES[k]}</option>)}
          <option value={CUSTOM}>Eigene Kategorie (Freitext) …</option>
        </select>
        {custom && (
          <input value={current} onChange={(e) => set(e.target.value)} required minLength={2} maxLength={40}
            placeholder="z. B. Reinigung" className={cx(inputCls, "w-1/2")} dir="auto" aria-label="Eigene Kategorie" />
        )}
      </div>
      <input type="hidden" name={name} value={current} />
    </Field>
  );
}
