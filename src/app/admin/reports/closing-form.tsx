"use client";

import { btn, cx, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function ClosingForm({ today, lastMonth }: { today: string; lastMonth: string }) {
  const { call, busy, error } = useApi();
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
        e.preventDefault();
        const period = new FormData(e.currentTarget).get("day") as string;
        call("POST", "/api/v1/reports/closings", { periodType: "DAY", period });
      }}>
        <label className="flex-1 text-sm"><span className="mb-1 block font-medium">Tagesabschluss</span>
          <input type="date" name="day" max={today} defaultValue={today} className={inputCls} /></label>
        <button disabled={busy} className={cx(btn.base, btn.secondary)}>Abschließen</button>
      </form>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
        e.preventDefault();
        const period = new FormData(e.currentTarget).get("month") as string;
        if (confirm(`Monat ${period} abschließen? Danach sind keine Buchungen in diesem Monat mehr möglich.`)) {
          call("POST", "/api/v1/reports/closings", { periodType: "MONTH", period });
        }
      }}>
        <label className="flex-1 text-sm"><span className="mb-1 block font-medium">Monatsabschluss</span>
          <input type="month" name="month" max={lastMonth} defaultValue={lastMonth} className={inputCls} /></label>
        <button disabled={busy} className={cx(btn.base, btn.secondary)}>Abschließen</button>
      </form>
      <p className="text-xs text-muted">Der Tagesabschluss friert die Summen als Protokoll ein. Der Monatsabschluss sperrt zusätzlich alle Buchungen des Monats.</p>
      <ErrorNote error={error} />
    </div>
  );
}
