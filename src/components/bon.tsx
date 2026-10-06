import { formatCents } from "@/domain/money";

/**
 * Der Kassenbon: das eine markante Element der Mitarbeiter-App.
 * Zeigt das Guthaben wie einen frisch gedruckten Bon mit gezacktem Abriss.
 */
export function Bon({ tenant, balanceCents, lines, stamp }: {
  tenant: string;
  balanceCents: number;
  lines: { label: string; cents: number }[];
  stamp: string;
}) {
  return (
    <div className="bon bon-print px-5 pb-8 pt-5 font-bon text-[13px] text-ink shadow-[0_1px_0_var(--color-line)]">
      <p className="text-center font-semibold">{tenant}</p>
      <p className="text-center text-muted">{stamp}</p>
      <div className="my-3 border-t border-dashed border-ink/30" />
      <dl className="space-y-1">
        {lines.map((l) => (
          <div key={l.label} className="flex justify-between gap-3">
            <dt>{l.label}</dt>
            <dd className="tabular">{formatCents(l.cents)}</dd>
          </div>
        ))}
      </dl>
      <div className="my-3 border-t border-dashed border-ink/30" />
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">Dein Guthaben</span>
      </div>
      <p className={`mt-1 text-right text-[40px] font-semibold leading-none tracking-tight tabular ${balanceCents === 0 ? "text-muted" : ""}`}>
        {formatCents(balanceCents)}
      </p>
    </div>
  );
}
