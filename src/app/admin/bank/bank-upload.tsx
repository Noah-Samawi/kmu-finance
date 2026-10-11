"use client";

import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function BankUpload({ defaultMonth }: { defaultMonth: string }) {
  const { call, busy, error } = useApi();
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      await call("POST", "/api/v1/bank/statements", fd);
    }}>
      <Field label="Monat"><input name="periodMonth" type="month" required defaultValue={defaultMonth} className={inputCls} /></Field>
      <input name="file" type="file" accept=".csv,.ofx,.qfx,.txt,text/csv" required className="text-sm" />
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>Auszug einlesen</button>
    </form>
  );
}
