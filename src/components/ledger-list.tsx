import Link from "next/link";
import type { LedgerRow } from "@/application/reports/reports";
import { LEDGER_LABEL } from "@/domain/ledger";
import { fmtDateTime } from "@/domain/period";
import { DIRECTLY_REVERSIBLE } from "@/domain/ledger";
import { categoryLabel, entryLabel } from "@/domain/cash";
import { Empty, Money, Pill } from "./ui";
import { ReverseButton } from "./reverse-button";

function label(r: LedgerRow) {
  return r.type === "REVERSAL" && r.reversedType
    ? `Storno: ${entryLabel(r.reversedType, LEDGER_LABEL[r.reversedType], r)}`
    : entryLabel(r.type, LEDGER_LABEL[r.type], r);
}

/**
 * Buchungsliste. mode bestimmt, welche Spalte als Betrag zählt:
 *  - "pool": Wirkung auf den Kassenbestand
 *  - "wallet": Wirkung auf das Mitarbeiterkonto
 *  - "both": beide (Admin-Journal)
 */
export function LedgerList({ rows, mode, showEmployee, admin, reversedIds }: {
  rows: LedgerRow[]; mode: "pool" | "wallet" | "both"; showEmployee?: boolean; admin?: boolean; reversedIds?: Set<string>;
}) {
  if (!rows.length) return <Empty title="Noch keine Buchungen" />;
  const reversed = reversedIds ?? new Set(rows.filter((r) => r.reversalOfId).map((r) => r.reversalOfId!));
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="flex items-start gap-3 px-4 py-3 md:px-5">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
              {label(r)}
              {r.receiptStatus === "REJECTED" && r.type === "RECEIPT" && <Pill tone="red">abgelehnt</Pill>}
              {r.receiptStatus === "APPROVED" && <Pill tone="green">geprüft</Pill>}
              {reversed.has(r.id) && r.type !== "RECEIPT" && <Pill>storniert</Pill>}
              {r.closingId && <Pill>abgeschlossen</Pill>}
              {r.category && <Pill tone="amber">{categoryLabel(r.category)}</Pill>}
              {r.batchId && <Pill>zusammen erfasst · getrenntes Konto</Pill>}
            </p>
            <p className="truncate text-sm text-muted">
              {r.invoiceNumber && admin && r.invoiceId ? (
                <>
                  {r.description?.replace(r.invoiceNumber, "").trim() || "Rechnung"}{" "}
                  <Link className="text-ledger underline-offset-2 hover:underline" href={`/admin/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link>
                </>
              ) : (
                [showEmployee && r.employeeName, r.description].filter(Boolean).join(" – ")
              )}
            </p>
            <p className="text-xs text-muted">
              {fmtDateTime(r.bookingDate)}
              {r.attachmentId && (
                <> · <a className="text-ledger underline-offset-2 hover:underline" href={`/api/v1/ledger/${r.id}/attachment`} target="_blank" rel="noreferrer">Beleg ansehen</a></>
              )}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 text-right">
            {(mode === "pool" || mode === "both") && r.cashDeltaCents !== 0 && (
              <span className="text-sm">
                <span className="me-1 text-xs text-muted">Kasse (Bar)</span>
                <Money cents={r.cashDeltaCents} signed className="font-semibold" />
              </span>
            )}
            {(mode === "pool" || mode === "both") && r.bankDeltaCents !== 0 && (
              <span className="text-sm">
                <span className="me-1 text-xs text-muted">Bankkonto</span>
                <Money cents={r.bankDeltaCents} signed className="font-semibold" />
              </span>
            )}
            {(mode === "wallet" || mode === "both") && r.walletDeltaCents !== 0 && (
              <span className="text-sm">
                {mode === "both" && <span className="me-1 text-xs text-muted">Budget</span>}
                <Money cents={r.walletDeltaCents} signed className="font-semibold" />
              </span>
            )}
            {r.claimDeltaCents !== 0 && (
              <span className="text-sm">
                <span className="me-1 text-xs text-muted">Auslage</span>
                <Money cents={r.claimDeltaCents} signed className="font-semibold" />
              </span>
            )}
            {r.partnerDeltaCents !== 0 && (
              <span className="text-sm">
                <span className="me-1 text-xs text-muted">Kapital</span>
                <Money cents={r.partnerDeltaCents} signed className="font-semibold" />
              </span>
            )}
            {admin && DIRECTLY_REVERSIBLE.includes(r.type) && !reversed.has(r.id) && !r.closingId && <ReverseButton id={r.id} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
