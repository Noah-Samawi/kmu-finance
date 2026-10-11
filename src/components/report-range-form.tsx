import { btn, cx, Field, inputCls } from "./ui";
import { monthKey, todayKey } from "@/domain/period";

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Zeitraum aus der URL; Standard: laufender Monat */
export function resolveRange(sp: { from?: string; to?: string; month?: string }) {
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) {
    const [y, m] = sp.month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${sp.month}-${String(last).padStart(2, "0")}`;
    return { from: `${sp.month}-01`, to: to > todayKey() ? todayKey() : to };
  }
  const from = isDay(sp.from) ? sp.from! : `${monthKey()}-01`;
  const to = isDay(sp.to) ? sp.to! : todayKey();
  return { from, to };
}

export function ReportRangeForm({ from, to }: { from: string; to: string }) {
  const today = todayKey();
  return (
    <div className="mb-6 grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-[1fr_2fr]">
      <form className="flex items-end gap-2">
        <Field label="Monatsbericht" className="flex-1"><input type="month" name="month" defaultValue={from.slice(0, 7)} max={today.slice(0, 7)} className={inputCls} /></Field>
        <button className={cx(btn.base, btn.primary)}>Anzeigen</button>
      </form>
      <form className="flex flex-wrap items-end gap-2">
        <Field label="oder von" className="flex-1"><input type="date" name="from" defaultValue={from} max={today} className={inputCls} /></Field>
        <Field label="bis" className="flex-1"><input type="date" name="to" defaultValue={to} max={today} className={inputCls} /></Field>
        <button className={cx(btn.base, btn.secondary)}>Zeitraum</button>
      </form>
    </div>
  );
}
