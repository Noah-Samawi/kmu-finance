"use client";

import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function CashExpenseForm({ today }: { today: string }) {
  const { call, busy, error } = useApi();
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
      if (await call("POST", "/api/v1/me/cash-expense", { amountCents: f.amount, description: f.description, bookingDate: f.bookingDate })) form.reset();
    }}>
      <Field label="Betrag"><input name="amount" required inputMode="decimal" className={cx(inputCls, "text-right")} /></Field>
      <Field label="Datum"><input name="bookingDate" type="date" max={today} defaultValue={today} className={inputCls} /></Field>
      <Field label="Wofür? (Pflicht)"><input name="description" required minLength={3} className={inputCls} dir="auto" /></Field>
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.secondary, "w-full")}>Barausgabe eintragen</button>
    </form>
  );
}
