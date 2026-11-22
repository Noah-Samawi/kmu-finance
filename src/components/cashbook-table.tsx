"use client";

import { useMemo } from "react";
import type { LedgerRow } from "@/application/reports/reports";
import { LEDGER_LABEL, DIRECTLY_REVERSIBLE, entryAmount } from "@/domain/ledger";
import { categoryLabel, entryLabel } from "@/domain/cash";
import { openingFromClosing, withRunningBalance, type CashbookAccount } from "@/domain/cashbook";
import { formatCents } from "@/domain/money";
import { fmtDate } from "@/domain/period";
import { Empty, Money, Pill } from "./ui";
import { EntryActions } from "./entry-actions";
import { AttachBelegButton, DetachBelegButton } from "./attach-beleg";
import type { BranchOption } from "./branch-category";
import type { PersonOption } from "./cash-forms";

function label(r: LedgerRow) {
  return r.type === "REVERSAL" && r.reversedType
    ? `Storno: ${entryLabel(r.reversedType, LEDGER_LABEL[r.reversedType], r)}`
    : entryLabel(r.type, LEDGER_LABEL[r.type], r);
}

/** DATEV-Kassenbuch: Tabelle mit Einnahme / Ausgabe / Lfd. Bestand. */
export function CashbookTable({
  rows, account, closingCents, admin, branches, persons, highlightWithoutBeleg,
}: {
  rows: LedgerRow[];
  account: CashbookAccount;
  closingCents: number;
  admin?: boolean;
  branches?: BranchOption[];
  persons?: PersonOption[];
  highlightWithoutBeleg?: boolean;
}) {
  const reversed = useMemo(
    () => new Set(rows.filter((r) => r.reversalOfId).map((r) => r.reversalOfId!)),
    [rows],
  );

  const book = useMemo(() => {
    const money = rows.filter((r) => {
      if (account === "CASH") return r.cashDeltaCents !== 0;
      if (account === "BANK") return r.bankDeltaCents !== 0;
      return r.cashDeltaCents !== 0 || r.bankDeltaCents !== 0;
    });
    const opening = openingFromClosing(money, account, closingCents);
    return { opening, lines: withRunningBalance(money, account, opening) };
  }, [rows, account, closingCents]);

  if (!book.lines.length) return <Empty title="Keine Buchungen im Zeitraum" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-3 py-2 font-medium">Datum</th>
            <th className="px-3 py-2 font-medium">Belegtext &amp; Kategorie</th>
            <th className="px-3 py-2 text-right font-medium">Einnahme (+)</th>
            <th className="px-3 py-2 text-right font-medium">Ausgabe (−)</th>
            <th className="px-3 py-2 text-right font-medium">Lfd. Bestand</th>
            <th className="px-3 py-2 text-center font-medium">Beleg</th>
            <th className="px-3 py-2 text-right font-medium">Aktionen</th>
          </tr>
          <tr className="border-b border-line text-xs text-muted">
            <td className="px-3 py-1.5" colSpan={4}>Anfangsbestand</td>
            <td className="px-3 py-1.5 text-right tabular font-medium text-ink">{formatCents(book.opening)}</td>
            <td colSpan={2} />
          </tr>
        </thead>
        <tbody>
          {book.lines.map((r) => {
            const without = !r.attachmentId;
            const hi = highlightWithoutBeleg && without;
            return (
              <tr key={r.id} id={`entry-${r.id}`}
                className={`border-b border-line/80 ${hi ? "bg-amber-50/80" : ""} ${reversed.has(r.id) ? "opacity-60" : ""}`}>
                <td className="whitespace-nowrap px-3 py-2.5 tabular text-muted">
                  {fmtDate(new Date(r.bookingDate))}
                </td>
                <td className="max-w-[16rem] px-3 py-2.5">
                  <p className="truncate font-medium">{label(r)}</p>
                  <p className="truncate text-xs text-muted">
                    {[r.description, r.category && categoryLabel(r.category), r.branchName].filter(Boolean).join(" · ")}
                  </p>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {reversed.has(r.id) && r.type !== "RECEIPT" && <Pill>storniert</Pill>}
                    {without && <Pill tone="amber">Ohne Beleg</Pill>}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular">
                  {r.incomeCents > 0 ? <Money cents={r.incomeCents} className="font-medium text-ledger" /> : <span className="text-muted">–</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular">
                  {r.expenseCents > 0 ? <Money cents={r.expenseCents} className="font-medium text-minus" /> : <span className="text-muted">–</span>}
                </td>
                <td className="px-3 py-2.5 text-right tabular font-semibold">
                  {formatCents(r.runningBalanceCents)}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {r.attachmentId ? (
                    <div className="flex flex-col items-center gap-1">
                      <a href={`/api/v1/ledger/${r.id}/attachment`} target="_blank" rel="noreferrer"
                        title="Beleg öffnen"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-paper text-ledger hover:border-ledger">
                        <BelegIcon />
                      </a>
                      {admin && <DetachBelegButton ledgerEntryId={r.id} />}
                    </div>
                  ) : admin ? (
                    <AttachBelegButton ledgerEntryId={r.id} />
                  ) : (
                    <span className="text-xs text-muted">–</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {admin && DIRECTLY_REVERSIBLE.includes(r.type) && !reversed.has(r.id) && !r.closingId && (
                    <EntryActions
                      id={r.id} amountCents={entryAmount(r)} description={r.description ?? ""}
                      branchId={r.branchId} branches={branches}
                      persons={persons} personId={r.employeeId} partnerRole={r.partnerRole}
                      canEdit={!r.receiptId} editHint={r.receiptId ? "Beleg-Buchung: über Belege prüfen korrigieren" : undefined}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-paper font-semibold">
            <td className="px-3 py-2" colSpan={4}>Endbestand</td>
            <td className="px-3 py-2 text-right tabular">{formatCents(book.lines.at(-1)!.runningBalanceCents)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function BelegIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14 3v5h5M8 12h8M8 16h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
