"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn, cx, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function InvoiceActions({ id, status, isCancellation, today }: {
  id: string; status: "DRAFT" | "OPEN" | "PAID" | "CANCELED"; isCancellation: boolean; today: string;
}) {
  const router = useRouter();
  const { call, busy, error } = useApi();
  const [mode, setMode] = useState<null | "pay" | "cancel">(null);
  const [paidAt, setPaidAt] = useState(today);
  const [reason, setReason] = useState("");

  return (
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      <div className="flex flex-wrap gap-2">
        <a href={`/api/v1/invoices/${id}/pdf?inline=1`} target="_blank" className={cx(btn.base, btn.secondary)}>
          {status === "DRAFT" ? "PDF-Vorschau" : "PDF öffnen"}
        </a>
        {status === "DRAFT" && (
          <button disabled={busy} className={cx(btn.base, btn.danger)}
            onClick={async () => {
              if (!confirm("Entwurf endgültig löschen?")) return;
              if (await call("DELETE", `/api/v1/invoices/${id}`, undefined, { refresh: false })) router.push("/admin/invoices");
            }}>
            Entwurf löschen
          </button>
        )}
        {status === "OPEN" && <button className={cx(btn.base, btn.primary)} onClick={() => setMode(mode === "pay" ? null : "pay")}>Als bezahlt markieren</button>}
        {(status === "OPEN" || status === "PAID") && !isCancellation && (
          <button className={cx(btn.base, btn.danger)} onClick={() => setMode(mode === "cancel" ? null : "cancel")}>Stornieren</button>
        )}
      </div>

      {mode === "pay" && (
        <form className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3"
          onSubmit={async (e) => { e.preventDefault(); if (await call("POST", `/api/v1/invoices/${id}/pay`, { paidAt })) setMode(null); }}>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Zahlungseingang am</span>
            <input type="date" max={today} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={inputCls} />
          </label>
          <button disabled={busy} className={cx(btn.base, btn.primary)}>Zahlung buchen</button>
          <p className="w-full text-xs text-muted">Der Betrag fließt automatisch in den Kassenbestand.</p>
        </form>
      )}
      {mode === "cancel" && (
        <form className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3"
          onSubmit={async (e) => { e.preventDefault(); if (await call("POST", `/api/v1/invoices/${id}/cancel`, { reason })) setMode(null); }}>
          <label className="min-w-56 flex-1 text-sm">
            <span className="mb-1 block font-medium">Grund</span>
            <input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="z. B. falscher Betrag" />
          </label>
          <button disabled={busy} className={cx(btn.base, btn.danger)}>Stornorechnung erstellen</button>
          <p className="w-full text-xs text-muted">
            Es wird eine Stornorechnung mit eigener Nummer erstellt.{status === "PAID" && " Die Einnahme wird aus dem Kassenbestand zurückgebucht."}
          </p>
        </form>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
