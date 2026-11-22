"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { formatCents } from "@/domain/money";
import { btn, cx } from "./ui";

export function CashbookToolbar({
  cashCents, bankCents, branchLabel, from, to, branchId, withoutBelegCount,
}: {
  cashCents: number;
  bankCents: number;
  branchLabel?: string | null;
  from: string;
  to: string;
  branchId?: string;
  withoutBelegCount: number;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const assignMode = sp.get("assign") === "1";

  function toggleAssign() {
    const u = new URL(window.location.href);
    if (assignMode) u.searchParams.delete("assign");
    else u.searchParams.set("assign", "1");
    router.push(u.pathname + "?" + u.searchParams.toString());
  }

  const pdfQs = new URLSearchParams({ format: "pdf", from, to });
  if (branchId && branchId !== "none") pdfQs.set("branch", branchId);

  return (
    <div className="mb-6 rounded-xl border border-ledger/30 bg-ledger-soft/30 p-4 md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Heutiger Bestand</p>
          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
            <p>
              <span className="text-sm text-muted">Kasse (Bar)</span>{" "}
              <span className="text-2xl font-semibold tabular tracking-tight">{formatCents(cashCents)}</span>
            </p>
            <p>
              <span className="text-sm text-muted">Bankkonto</span>{" "}
              <span className="text-2xl font-semibold tabular tracking-tight">{formatCents(bankCents)}</span>
            </p>
          </div>
          {branchLabel && <p className="mt-1 text-xs text-muted">Filiale: {branchLabel}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="#erfassen" className={cx(btn.base, btn.primary)}>+ Erfassen</a>
          <button type="button" onClick={toggleAssign}
            className={cx(btn.base, assignMode ? btn.primary : btn.secondary)}>
            Belege zuordnen{withoutBelegCount > 0 ? ` (${withoutBelegCount})` : ""}
          </button>
          <a href={`/api/v1/reports/export?${pdfQs}`} className={cx(btn.base, btn.secondary)}
            target="_blank" rel="noreferrer">
            Erfassungsbericht / PDF
          </a>
        </div>
      </div>
      {assignMode && (
        <p className="mt-3 text-sm text-amber-800">
          Modus „Belege zuordnen“: Buchungen ohne Beleg sind markiert – rechts „Beleg zuordnen“ wählen.
          {withoutBelegCount === 0 && " Aktuell haben alle sichtbaren Buchungen einen Beleg."}
        </p>
      )}
    </div>
  );
}
