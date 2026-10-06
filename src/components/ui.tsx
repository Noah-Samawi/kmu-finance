import Link from "next/link";
import { formatCents } from "@/domain/money";
import { STATUS_LABEL, type DisplayStatus } from "@/domain/invoice";

// Kleine, bewusst schlichte UI-Bausteine (kein Fremd-Kit nötig)

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export const btn = {
  base: "inline-flex items-center justify-center gap-2 rounded-lg px-4 h-11 text-[15px] font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none",
  primary: "bg-ledger text-white hover:bg-ledger-dark",
  secondary: "bg-surface text-ink border border-line hover:border-ink/40",
  danger: "bg-surface text-minus border border-minus/30 hover:bg-minus-soft",
  ghost: "text-ledger hover:bg-ledger-soft",
  sm: "h-9 px-3 text-sm",
};

export function ButtonLink({ href, children, variant = "secondary", small }: { href: string; children: React.ReactNode; variant?: keyof typeof btn; small?: boolean }) {
  return <Link href={href} className={cx(btn.base, btn[variant], small && btn.sm)}>{children}</Link>;
}

export const inputCls =
  "w-full h-11 rounded-lg border border-line bg-surface px-3 text-ink placeholder:text-muted/70 focus:border-ledger focus:outline-none focus:ring-2 focus:ring-ledger/20";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Betrag mit Vorzeichenfarbe. signed: +/− anzeigen */
export function Money({ cents, signed, className }: { cents: number; signed?: boolean; className?: string }) {
  const color = signed ? (cents > 0 ? "text-ledger" : cents < 0 ? "text-minus" : "text-muted") : "";
  const text = signed && cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
  return <span className={cx("tabular whitespace-nowrap", color, className)}>{text}</span>;
}

const statusStyle: Record<DisplayStatus, string> = {
  DRAFT: "bg-paper text-muted border-line",
  OPEN: "bg-surface text-ink border-ink/25",
  PAID: "bg-ledger-soft text-ledger border-ledger/25",
  OVERDUE: "bg-amber-soft text-amber border-amber/30",
  CANCELED: "bg-minus-soft text-minus border-minus/20 line-through decoration-1",
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", statusStyle[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "red" | "amber" }) {
  const t = { neutral: "bg-paper text-muted", green: "bg-ledger-soft text-ledger", red: "bg-minus-soft text-minus", amber: "bg-amber-soft text-amber" }[tone];
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", t)}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className, flush }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cx("rounded-xl border border-line bg-surface", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 md:px-5">
          {title && <h2 className="font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={flush ? "" : "p-4 md:p-5"}>{children}</div>
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Tabelle, die auf dem Handy horizontal scrollt statt zu quetschen */
export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            {head.map((h, i) => <th key={i} className="px-4 py-2.5 font-medium first:pl-4 md:first:pl-5">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-4 py-3 first:pl-4 md:first:pl-5 align-top";
