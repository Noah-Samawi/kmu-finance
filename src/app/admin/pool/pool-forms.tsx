"use client";

import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { formatCents } from "@/domain/money";

export function IncomeForm({ today }: { today: string }) {
  const { call, busy, error } = useApi();
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
      if (await call("POST", "/api/v1/pool/income", { amountCents: f.amount, description: f.description, bookingDate: f.bookingDate || undefined })) form.reset();
    }}>
      <div className="grid grid-cols-[1fr_150px] gap-3">
        <Field label="Betrag"><input name="amount" required inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} /></Field>
        <Field label="Datum"><input name="bookingDate" type="date" max={today} defaultValue={today} className={inputCls} /></Field>
      </div>
      <Field label="Wofür?"><input name="description" required minLength={2} placeholder="z. B. Tageskasse Laden" className={inputCls} /></Field>
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.secondary, "w-full")}>Einnahme buchen</button>
    </form>
  );
}

export function AllocationForm({ employees, poolCents, presetEmployeeId }: { employees: { id: string; name: string; balanceCents: number }[]; poolCents: number; presetEmployeeId?: string }) {
  const { call, busy, error } = useApi();
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
      if (await call("POST", "/api/v1/pool/allocations", { employeeId: f.employeeId, amountCents: f.amount, description: f.description || null })) form.reset();
    }}>
      {!presetEmployeeId ? (
        <Field label="An wen?">
          <select name="employeeId" required className={inputCls}>
            <option value="">Mitarbeiter wählen …</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name} (Guthaben {formatCents(e.balanceCents)})</option>)}
          </select>
        </Field>
      ) : <input type="hidden" name="employeeId" value={presetEmployeeId} />}
      <Field label="Betrag" hint={`Verfügbar: ${formatCents(poolCents)}`}>
        <input name="amount" required inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} />
      </Field>
      <Field label="Zweck (optional)"><input name="description" placeholder="z. B. Wareneinkauf Großmarkt" className={inputCls} /></Field>
      <ErrorNote error={error} />
      <button disabled={busy || poolCents <= 0} className={cx(btn.base, btn.primary, "w-full")}>Budget zuteilen</button>
    </form>
  );
}
