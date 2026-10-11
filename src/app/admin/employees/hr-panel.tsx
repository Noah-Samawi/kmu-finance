"use client";

import { useMemo, useState } from "react";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { monthlyGrossFromHours } from "@/domain/payroll";
import { centsToPlain, formatCents, parseEuroToCents } from "@/domain/money";

const KINDS = [
  { id: "ID", label: "Ausweis / Pass" },
  { id: "CONTRACT", label: "Arbeitsvertrag" },
  { id: "TIMESHEET", label: "Stundennachweis" },
  { id: "TAX", label: "Lohnsteuer" },
  { id: "PAYSLIP", label: "Abrechnung" },
  { id: "OTHER", label: "Sonstiges" },
];

function hoursNumber(s: string): number {
  const n = Number(s.trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function HrPanel({ employeeId, profile, documents, payslips }: {
  employeeId: string;
  profile: Record<string, unknown> | null;
  documents: { id: string; kind: string; title: string; createdAt: Date | string }[];
  payslips: { id: string; year: number; month: number; grossCents: number; netCents: number }[];
}) {
  const { call, busy, error } = useApi();
  const p = profile ?? {};
  const d = (k: string) => {
    const v = p[k];
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    return typeof v === "string" || typeof v === "number" ? String(v) : "";
  };

  const [hourlyRate, setHourlyRate] = useState(
    typeof p.hourlyRateCents === "number" && p.hourlyRateCents ? centsToPlain(p.hourlyRateCents) : "",
  );
  const [hoursPerMonth, setHoursPerMonth] = useState(d("hoursPerMonth"));

  const grossCents = useMemo(() => {
    try {
      const rate = hourlyRate.trim() ? parseEuroToCents(hourlyRate) : 0;
      return monthlyGrossFromHours(hoursNumber(hoursPerMonth), rate);
    } catch {
      return 0;
    }
  }, [hourlyRate, hoursPerMonth]);

  return (
    <div className="space-y-8">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        await call("PUT", `/api/v1/employees/${employeeId}/hr`, {
          ...f,
          hourlyRateCents: hourlyRate,
          hoursPerMonth,
          monthlyGrossCents: centsToPlain(grossCents),
        });
      }}>
        <Field label="Tätigkeit"><input name="jobTitle" defaultValue={d("jobTitle")} className={inputCls} /></Field>
        <Field label="Eintritt"><input name="startDate" type="date" defaultValue={d("startDate")} className={inputCls} /></Field>
        <Field label="Geburtsdatum"><input name="dateOfBirth" type="date" defaultValue={d("dateOfBirth")} className={inputCls} /></Field>
        <Field label="Straße"><input name="street" defaultValue={d("street")} className={inputCls} /></Field>
        <Field label="PLZ / Ort" className="grid grid-cols-[100px_1fr] gap-2">
          <input name="zip" defaultValue={d("zip")} className={inputCls} />
          <input name="city" defaultValue={d("city")} className={inputCls} />
        </Field>
        <Field label="Steuer-ID"><input name="taxId" defaultValue={d("taxId")} className={inputCls} dir="auto" /></Field>
        <Field label="SV-Nummer"><input name="socialSecurityNumber" defaultValue={d("socialSecurityNumber")} className={inputCls} /></Field>
        <Field label="Steuerklasse">
          <select name="taxClass" defaultValue={d("taxClass") || "1"} className={inputCls}>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Kinderfreibeträge"><input name="childAllowances" type="number" min={0} defaultValue={d("childAllowances") || "0"} className={inputCls} /></Field>
        <Field label="Kirchensteuer">
          <select name="churchTax" defaultValue={d("churchTax") || "NONE"} className={inputCls}>
            <option value="NONE">keine</option>
            <option value="EIGHT">8 % (z. B. Bayern/BW)</option>
            <option value="NINE">9 %</option>
          </select>
        </Field>
        <Field label="Krankenkasse"><input name="healthInsuranceName" defaultValue={d("healthInsuranceName")} className={inputCls} dir="auto" /></Field>
        <Field label="KV-Zusatzbeitrag (BP)" hint="250 = 2,50 %"><input name="kvAdditionalBp" type="number" defaultValue={d("kvAdditionalBp") || "250"} className={inputCls} /></Field>
        <Field label="Stundenlohn (€/Std.)">
          <input name="hourlyRateCents" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} inputMode="decimal" placeholder="0,00" className={inputCls} />
        </Field>
        <Field label="Arbeitsstunden / Monat">
          <input name="hoursPerMonth" value={hoursPerMonth} onChange={(e) => setHoursPerMonth(e.target.value)} inputMode="decimal" placeholder="z. B. 160" className={inputCls} />
        </Field>
        <Field label="Brutto / Monat" hint="Stundenlohn × Arbeitsstunden, automatisch">
          <input
            readOnly
            tabIndex={-1}
            value={grossCents ? formatCents(grossCents) : ""}
            className={cx(inputCls, "bg-paper text-muted")}
            placeholder="wird berechnet"
          />
        </Field>
        <Field label="IBAN"><input name="iban" defaultValue={d("iban")} className={inputCls} /></Field>
        <Field label="Notizen" className="sm:col-span-2"><textarea name="notes" defaultValue={d("notes")} rows={2} className={cx(inputCls, "h-auto py-2")} dir="auto" /></Field>
        <div className="sm:col-span-2"><button disabled={busy} className={cx(btn.base, btn.primary)}>Personalakte speichern</button></div>
      </form>

      <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        await call("POST", `/api/v1/employees/${employeeId}/hr/documents`, fd);
        form.reset();
      }}>
        <p className="font-semibold">Unterlage hochladen</p>
        <Field label="Art"><select name="kind" className={inputCls}>{KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</select></Field>
        <Field label="Titel"><input name="title" required className={inputCls} dir="auto" /></Field>
        <input name="file" type="file" required className="text-sm" />
        <button disabled={busy} className={cx(btn.base, btn.secondary, btn.sm)}>Hochladen</button>
      </form>
      <ul className="divide-y divide-line text-sm">
        {documents.map((doc) => (
          <li key={doc.id} className="flex justify-between gap-2 py-2">
            <span dir="auto">{doc.title}</span>
            <a className="text-ledger" href={`/api/v1/employees/${employeeId}/hr/documents/${doc.id}/file`} target="_blank">Öffnen</a>
          </li>
        ))}
      </ul>

      <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget));
        await call("POST", `/api/v1/employees/${employeeId}/payslips`, f);
      }}>
        <Field label="Jahr"><input name="year" type="number" required defaultValue={new Date().getFullYear()} className={inputCls} /></Field>
        <Field label="Monat"><input name="month" type="number" min={1} max={12} required defaultValue={new Date().getMonth() + 1} className={inputCls} /></Field>
        <Field label="Stunden"><input name="hoursWorked" inputMode="decimal" placeholder={hoursPerMonth || "Stunden"} className={inputCls} /></Field>
        <Field label="€/Std."><input name="hourlyRateCents" placeholder={hourlyRate || ""} className={inputCls} /></Field>
        <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>Lohnabrechnung erstellen</button>
      </form>
      <ul className="divide-y divide-line text-sm">
        {payslips.map((s) => (
          <li key={s.id} className="flex justify-between py-2">
            <span>{String(s.month).padStart(2, "0")}/{s.year} · Brutto {formatCents(s.grossCents)} · Netto {formatCents(s.netCents)}</span>
            <a className="text-ledger" href={`/api/v1/employees/${employeeId}/payslips/${s.id}/pdf`} target="_blank">PDF</a>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
    </div>
  );
}
