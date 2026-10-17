import { accountFlowLines, type AccountFlow } from "@/domain/cash";
import type { AccountKind } from "@/domain/accounts";
import { formatCents } from "@/domain/money";
import { cx } from "./ui";

/** Kontobewegung EINES Firmenkontos – Kasse (Bar) und Bankkonto werden nie zusammengerechnet */
export function AccountFlowList({ account, flow }: { account: AccountKind; flow: AccountFlow }) {
  return (
    <dl className="space-y-1.5 tabular">
      {accountFlowLines(account, flow).map((l) => (
        <div key={l.label} className={cx("flex items-baseline justify-between gap-4 text-[15px]", l.strong && "border-t-2 border-ink pt-2 font-semibold")}>
          <dt className={l.strong ? "" : "text-muted"}>{l.label}</dt>
          <dd className={l.strong ? "text-xl" : ""}>{formatCents(l.cents)}</dd>
        </div>
      ))}
    </dl>
  );
}
