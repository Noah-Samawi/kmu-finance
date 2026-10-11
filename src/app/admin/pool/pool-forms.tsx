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
      if (await call("POST", "/api/v1/pool/income", { amountCents: f.amount, description: f.description, bookingDate: f.bookingDate || undefined, accountKind: f.accountKind })) form.reset();
    }}>
      <div className="grid grid-cols-[1fr_150px] gap-3">
        <Field label="Betrag"><input name="amount" required inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} /></Field>
        <Field label="Datum"><input name="bookingDate" type="date" max={today} defaultValue={today} className={inputCls} /></Field>
      </div>
      <Field label="Konto">
        <select name="accountKind" className={inputCls} defaultValue="CASH">
          <option value="CASH">Kasse (Bar)</option>
          <option value="BANK">Bankkonto</option>
        </select>
      </Field>
      <Field label="Wofür?"><input name="description" required minLength={2} placeholder="z. B. Tageskasse Laden" className={inputCls} dir="auto" /></Field>
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.secondary, "w-full")}>Einnahme buchen</button>
    </form>
  );
}

export function AllocationForm({ employees, poolCents, cashCents, bankCents, presetEmployeeId }: { employees: { id: string; name: string; balanceCents: number }[]; poolCents: number; cashCents?: number; bankCents?: number; presetEmployeeId?: string }) {
  const { call, busy, error } = useApi();
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
      if (await call("POST", "/api/v1/pool/allocations", { employeeId: f.employeeId, amountCents: f.amount, description: f.description || null, accountKind: f.accountKind })) form.reset();
    }}>
      {!presetEmployeeId ? (
        <Field label="An wen?">
          <select name="employeeId" required className={inputCls}>
            <option value="">Mitarbeiter wählen …</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name} (Guthaben {formatCents(e.balanceCents)})</option>)}
          </select>
        </Field>
      ) : <input type="hidden" name="employeeId" value={presetEmployeeId} />}
      <Field label="Herkunftskonto">
        <select name="accountKind" className={inputCls} defaultValue="CASH">
          <option value="CASH">Kasse (Bar){cashCents != null ? ` · ${formatCents(cashCents)}` : ""}</option>
          <option value="BANK">Bankkonto{bankCents != null ? ` · ${formatCents(bankCents)}` : ""}</option>
        </select>
      </Field>
      <Field label="Betrag" hint={`Gesamt frei: ${formatCents(poolCents)}`}>
        <input name="amount" required inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} />
      </Field>
      <Field label="Zweck (optional)"><input name="description" placeholder="z. B. Wareneinkauf Großmarkt" className={inputCls} dir="auto" /></Field>
      <ErrorNote error={error} />
      <button disabled={busy || poolCents <= 0} className={cx(btn.base, btn.primary, "w-full")}>Budget zuteilen</button>
    </form>
  );
}

export function AccountAdjustForm() {
  const { call, busy, error } = useApi();
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
      const signed = f.dir === "out" ? `-${f.amount}` : f.amount;
      if (await call("POST", "/api/v1/accounts/adjust", { accountKind: f.accountKind, amountCents: signed, description: f.description })) form.reset();
    }}>
      <Field label="Konto">
        <select name="accountKind" className={inputCls}><option value="CASH">Kasse (Bar)</option><option value="BANK">Bankkonto</option></select>
      </Field>
      <Field label="Richtung">
        <select name="dir" className={inputCls}><option value="in">Erhöhung (+)</option><option value="out">Minderung (−)</option></select>
      </Field>
      <Field label="Betrag"><input name="amount" required inputMode="decimal" className={cx(inputCls, "text-right")} /></Field>
      <Field label="Wofür? (Pflicht)"><input name="description" required minLength={3} className={inputCls} dir="auto" /></Field>
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.secondary, "w-full")}>Bestand korrigieren</button>
    </form>
  );
}
