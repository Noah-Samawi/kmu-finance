"use client";

import { useState } from "react";
import Link from "next/link";
import { EntryActions } from "./entry-actions";
import { btn, cx, Empty, Field, inputCls, Money, Pill, Table, td } from "./ui";
import { ErrorNote, useApi } from "./use-api";
import { formatCents } from "@/domain/money";
import { fmtDate } from "@/domain/period";
import type { BranchOption } from "./branch-category";

export interface BillRow {
  id: string;
  supplier: string;
  amountCents: number;
  paidCents: number;
  dueCents: number;
  creditCents: number;
  status: "OPEN" | "PAID" | "CREDIT";
  statusLabel: string;
  bookedLabel: string;
  bookedWhere: "CASH" | "BANK" | null;
  payKind: "CASH" | "BANK" | "UNPAID";
  categoryLabel: string;
  purpose: string | null;
  bookingDate: string;
  branchName: string | null;
  ledgerEntryId: string | null;
  hasFile: boolean;
}

function statusTone(s: BillRow["status"]): "green" | "red" | "amber" {
  return s === "PAID" ? "green" : s === "CREDIT" ? "amber" : "red";
}

function PayRest({ bill }: { bill: BillRow }) {
  const { call, busy, error, setError } = useApi();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"CASH" | "BANK">("CASH");
  const due = formatCents(bill.dueCents).replace(/[^\d,.-]/g, "");

  if (bill.status !== "OPEN" || bill.dueCents <= 0) return null;

  return (
    <div className="mt-1">
      <button type="button" className="text-xs font-medium text-ledger underline-offset-2 hover:underline" onClick={() => setOpen((v) => !v)}>
        Jetzt bezahlen
      </button>
      {open && (
        <form className="mt-2 space-y-2 rounded-lg border border-line bg-paper p-3" onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const r = await call("POST", `/api/v1/bills/${bill.id}/pay`, {
            payKind: kind, paidCents: String(fd.get("paid") || due),
          });
          if (r) setOpen(false);
        }}>
          <fieldset className="space-y-1">
            <legend className="text-xs font-semibold">Wie wird jetzt bezahlt?</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={kind === "CASH"} onChange={() => setKind("CASH")} className="accent-[var(--color-ledger)]" />
              Bar (Kasse) → Ausgabe Kasse (Bar)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={kind === "BANK"} onChange={() => setKind("BANK")} className="accent-[var(--color-ledger)]" />
              Karte / Überweisung → Ausgabe Bankkonto
            </label>
          </fieldset>
          <Field label={`Betrag (offen ${formatCents(bill.dueCents)})`}>
            <input name="paid" defaultValue={due} inputMode="decimal" className={cx(inputCls, "text-right tabular")} />
          </Field>
          <ErrorNote error={error} />
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm, "w-full")}>Zahlung buchen</button>
        </form>
      )}
    </div>
  );
}

function RemoveUnpaid({ id }: { id: string }) {
  const { call, busy, error, setError } = useApi();
  return (
    <div>
      <button type="button" disabled={busy} className="text-xs font-medium text-minus underline-offset-2 hover:underline"
        onClick={() => {
          const r = prompt("Offene Rechnung entfernen – Grund?");
          if (r === null) return;
          if (r.trim().length < 3) return setError("Bitte einen Grund angeben (mind. 3 Zeichen)");
          call("POST", `/api/v1/bills/${id}/cancel`, { reason: r.trim() });
        }}>
        Löschen
      </button>
      <ErrorNote error={error} />
    </div>
  );
}

export function BillList({ bills, branches, emptyTitle }: { bills: BillRow[]; branches?: BranchOption[]; emptyTitle?: string }) {
  if (!bills.length) {
    return <Empty title={emptyTitle ?? "Noch keine Eingangsrechnungen"}>{!emptyTitle && "Rechnung oder Quittung oben hochladen – Zahlungskanal und Filiale wählen, dann bestätigen."}</Empty>;
  }
  return (
    <Table head={["Lieferant", "Wo gebucht", "Status", "Filiale", <span key="b" className="block text-right">Betrag</span>, ""]}>
      {bills.map((b) => (
        <tr key={b.id} className="hover:bg-paper">
          <td className={td}>
            <span className="font-medium">{b.supplier}</span>
            <span className="block text-xs text-muted">
              {fmtDate(new Date(b.bookingDate))}
              {b.categoryLabel ? ` · ${b.categoryLabel}` : ""}
              {b.purpose && b.purpose !== b.supplier ? ` · ${b.purpose}` : ""}
            </span>
            {b.hasFile && (
              <a href={`/api/v1/bills/${b.id}/file`} target="_blank" rel="noreferrer" className="text-xs text-ledger hover:underline">Beleg ansehen</a>
            )}
          </td>
          <td className={td}>
            <Pill tone={b.bookedWhere ? "green" : "amber"}>{b.bookedLabel}</Pill>
          </td>
          <td className={td}>
            <span className={cx(
              "inline-flex max-w-[16rem] items-center rounded-full border px-2.5 py-1 text-xs font-bold leading-tight",
              b.status === "PAID" ? "border-ledger/30 bg-ledger-soft text-ledger"
                : b.status === "CREDIT" ? "border-amber/30 bg-amber-soft text-amber"
                  : "border-minus/30 bg-minus-soft text-minus",
            )}>{b.statusLabel}</span>
            <PayRest bill={b} />
          </td>
          <td className={td + " text-muted"}>{b.branchName ?? "zentral"}</td>
          <td className={td + " text-right"}>
            <Money cents={b.amountCents} className="font-medium" />
            {b.paidCents !== b.amountCents && (
              <span className="block text-xs text-muted">gezahlt {formatCents(b.paidCents)}</span>
            )}
          </td>
          <td className={td + " text-right"}>
            {b.ledgerEntryId ? (
              <EntryActions id={b.ledgerEntryId} amountCents={b.paidCents || b.amountCents} description={b.purpose || b.supplier} branches={branches} />
            ) : b.paidCents === 0 ? (
              <RemoveUnpaid id={b.id} />
            ) : null}
          </td>
        </tr>
      ))}
    </Table>
  );
}

export function BillStatusFilters({ current, tabHref }: { current?: string; tabHref: string }) {
  const items: { key?: string; label: string }[] = [
    { label: "Alle" }, { key: "OPEN", label: "Offen" }, { key: "PAID", label: "Bezahlt" }, { key: "CREDIT", label: "Guthaben" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((f) => {
        const href = f.key ? `${tabHref}&bill=${f.key}` : tabHref;
        const on = current === f.key || (!current && !f.key);
        return (
          <Link key={f.label} href={href}
            className={cx("rounded-full border px-3 py-1.5 text-sm font-medium",
              on ? "border-ledger bg-ledger text-white" : "border-line bg-surface text-muted hover:text-ink")}>
            {f.label}
          </Link>
        );
      })}
    </div>
  );
}
