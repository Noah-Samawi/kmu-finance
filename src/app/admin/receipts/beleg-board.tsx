"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BELEG_DOC_TYPE_LABEL, BELEG_STATUS_LABEL, type BelegDocType, type BelegStatus } from "@/domain/beleg";
import { formatCents } from "@/domain/money";
import { fmtDate } from "@/domain/period";
import type { BranchOption } from "@/components/branch-category";
import { btn, cx, Empty, Money, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export type BelegCard = {
  id: string;
  status: BelegStatus;
  docType: BelegDocType;
  branchId: string | null;
  branchName: string | null;
  amountCents: number | null;
  merchant: string | null;
  bookingDate: Date | string | null;
  createdAt: Date | string;
  fileMime: string;
  ocrStatus: string;
  receiptNumber: string | null;
};

function periodBounds(preset: string): { from?: string; to?: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === "week") {
    const s = new Date(now); s.setDate(now.getDate() - 7);
    return { from: iso(s), to: iso(now) };
  }
  if (preset === "month") {
    return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to: iso(now) };
  }
  if (preset === "year") {
    const s = new Date(now); s.setFullYear(now.getFullYear() - 1);
    return { from: iso(s), to: iso(now) };
  }
  return {};
}

export function BelegBoard({
  rows, tab, branches, selectedId,
}: {
  rows: BelegCard[];
  tab: "inbox" | "filed" | "all" | "trash";
  branches?: BranchOption[];
  selectedId?: string | null;
}) {
  const { call, busy, error, setError } = useApi();
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [period, setPeriod] = useState(tab === "inbox" ? "all" : "month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "INBOX" | "FILED">("ALL");
  const [branchId, setBranchId] = useState("");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const bounds = period === "custom" ? { from: from || undefined, to: to || undefined } : periodBounds(period);
    const qn = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab === "all" && statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (branchId === "none" && r.branchId) return false;
      if (branchId && branchId !== "none" && r.branchId !== branchId) return false;
      if (bounds.from) {
        const d = new Date(r.createdAt).toISOString().slice(0, 10);
        if (d < bounds.from) return false;
      }
      if (bounds.to) {
        const d = new Date(r.createdAt).toISOString().slice(0, 10);
        if (d > bounds.to) return false;
      }
      if (qn) {
        const hay = `${r.merchant ?? ""} ${r.receiptNumber ?? ""} ${r.amountCents ?? ""}`.toLowerCase();
        if (!hay.includes(qn)) return false;
      }
      return true;
    });
  }, [rows, period, from, to, branchId, q, tab, statusFilter]);

  const ids = filtered.map((r) => r.id);
  const selectedIds = ids.filter((id) => picked[id]);
  const selectedSum = filtered.filter((r) => picked[r.id]).reduce((s, r) => s + (r.amountCents ?? 0), 0);
  const allOn = ids.length > 0 && ids.every((id) => picked[id]);

  async function bulk(action: "trash" | "restore" | "purge") {
    if (!selectedIds.length) return setError("Bitte Belege auswählen");
    const label = action === "trash" ? "in den Papierkorb verschieben"
      : action === "restore" ? "wiederherstellen" : "endgültig löschen";
    if (!confirm(`${selectedIds.length} Beleg(e), Summe ${formatCents(selectedSum)} – wirklich ${label}?`)) return;
    if (await call("POST", "/api/v1/belege/bulk", { action, ids: selectedIds })) {
      setPicked({});
      router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-paper p-3">
        <label className="text-xs text-muted">Zeitraum
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className={cx(inputCls, "mt-1")}>
            <option value="week">Diese Woche</option>
            <option value="month">Dieser Monat</option>
            <option value="year">Letzte 12 Monate</option>
            <option value="all">Alle</option>
            <option value="custom">Von–Bis</option>
          </select>
        </label>
        {period === "custom" && (
          <>
            <label className="text-xs text-muted">Von<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={cx(inputCls, "mt-1")} /></label>
            <label className="text-xs text-muted">Bis<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={cx(inputCls, "mt-1")} /></label>
          </>
        )}
        {tab === "all" && (
          <label className="text-xs text-muted">Status
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "ALL" | "INBOX" | "FILED")} className={cx(inputCls, "mt-1")}>
              <option value="ALL">Alle</option>
              <option value="INBOX">Offen</option>
              <option value="FILED">Verbucht</option>
            </select>
          </label>
        )}
        <label className="text-xs text-muted">Filiale
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={cx(inputCls, "mt-1")}>
            <option value="">Alle</option>
            <option value="none">Zentral</option>
            {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="min-w-[10rem] flex-1 text-xs text-muted">Suche
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Händler, Betrag, Beleg-Nr." className={cx(inputCls, "mt-1")} />
        </label>
      </div>

      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allOn} onChange={(e) => {
              const on = e.target.checked;
              setPicked((p) => {
                const n = { ...p };
                for (const id of ids) { if (on) n[id] = true; else delete n[id]; }
                return n;
              });
            }} />
            Alle auswählen ({filtered.length})
          </label>
          {selectedIds.length > 0 && (
            <span className="text-sm text-muted">{selectedIds.length} markiert · {formatCents(selectedSum)}</span>
          )}
          {tab !== "trash" && selectedIds.length > 0 && (
            <button type="button" disabled={busy} className={cx(btn.base, btn.sm, btn.danger)} onClick={() => void bulk("trash")}>
              In Papierkorb
            </button>
          )}
          {tab === "trash" && selectedIds.length > 0 && (
            <>
              <button type="button" disabled={busy} className={cx(btn.base, btn.sm, btn.secondary)} onClick={() => void bulk("restore")}>Wiederherstellen</button>
              <button type="button" disabled={busy} className={cx(btn.base, btn.sm, btn.danger)} onClick={() => void bulk("purge")}>Endgültig löschen</button>
            </>
          )}
        </div>
      )}

      <ErrorNote error={error} />

      {filtered.length === 0 ? (
        <Empty title={tab === "all" ? "Keine Belege" : BELEG_STATUS_LABEL[tab === "inbox" ? "INBOX" : tab === "filed" ? "FILED" : "TRASH"]} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => (
            <li key={r.id} className={cx(
              "flex overflow-hidden rounded-xl border bg-surface",
              selectedId === r.id ? "border-ledger ring-2 ring-ledger/30" : "border-line",
            )}>
              <label className="flex items-start p-2">
                <input type="checkbox" className="mt-2" checked={!!picked[r.id]}
                  onChange={(e) => setPicked((p) => ({ ...p, [r.id]: e.target.checked }))} />
              </label>
              <Link href={`/admin/receipts?tab=${tab}&beleg=${r.id}`} className="min-w-0 flex-1">
                <div className="aspect-[4/3] bg-paper">
                  {r.fileMime.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/v1/belege/${r.id}/file`} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-sm text-ledger">PDF</span>
                  )}
                </div>
                <div className="space-y-1 p-3">
                  <div className="flex justify-between gap-2">
                    <p className="truncate font-medium">{r.merchant || "Ohne Händler"}</p>
                    {r.amountCents != null && <Money cents={r.amountCents} className="font-semibold" />}
                  </div>
                  <p className="text-xs text-muted">
                    {fmtDate(new Date(r.bookingDate ?? r.createdAt))} · {BELEG_DOC_TYPE_LABEL[r.docType]}
                    {r.branchName ? ` · ${r.branchName}` : ""}
                    {r.ocrStatus === "PENDING" ? " · OCR…" : r.ocrStatus === "FAILED" ? " · OCR fehlgeschlagen" : ""}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
