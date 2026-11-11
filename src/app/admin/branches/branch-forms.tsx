"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn, cx, Field, inputCls, Pill } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { branchPdfUrl } from "@/domain/branch";

export interface Branch { id: string; name: string; city: string | null; isActive: boolean }

const SUGGESTED = ["Frankfurt", "Wiesbaden", "Offenbach", "Hamburg", "Eschborn"];

/** Filialen anlegen, umbenennen, löschen / archivieren */
export function BranchAdmin({ branches }: { branches: Branch[] }) {
  const { call, busy, error } = useApi();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const missing = SUGGESTED.filter((s) => !branches.some((b) => b.name.toLowerCase() === s.toLowerCase()));
  return (
    <div className="space-y-4">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        if (await call("POST", "/api/v1/branches", { name, city: city || name })) { setName(""); setCity(""); }
      }}>
        <Field label="Name der Filiale"><input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} placeholder="z. B. Frankfurt Innenstadt" className={inputCls} /></Field>
        <Field label="Ort / Notiz (optional)"><input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} placeholder="z. B. Frankfurt am Main" className={inputCls} /></Field>
        <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>Filiale anlegen</button>
      </form>
      {missing.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted">Schnell anlegen:</p>
          <div className="flex flex-wrap gap-2">
            {missing.map((m) => (
              <button key={m} type="button" disabled={busy} className={cx(btn.base, btn.secondary, btn.sm)}
                onClick={() => call("POST", "/api/v1/branches", { name: m, city: m })}>{`+ ${m}`}</button>
            ))}
          </div>
        </div>
      )}
      <ErrorNote error={error} />
      {branches.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {branches.map((b) => <BranchRow key={b.id} b={b} />)}
        </ul>
      )}
    </div>
  );
}

function BranchRow({ b }: { b: Branch }) {
  const [edit, setEdit] = useState(false);
  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{b.name}{b.city && b.city !== b.name ? <span className="text-muted">{` · ${b.city}`}</span> : null} {!b.isActive && <Pill tone="red">inaktiv</Pill>}</span>
        <BranchManageButtons b={b} onEdit={() => setEdit(true)} compact />
      </div>
      {edit && <BranchEditDialog b={b} onClose={() => setEdit(false)} />}
    </li>
  );
}

/** PDF, Bearbeiten und Löschen in der Detailkarte – große Buttons, auch auf dem Handy */
export function BranchDetailActions({ branch, from, to }: {
  branch: Branch | null; from: string; to: string;
}) {
  const [edit, setEdit] = useState(false);
  const pdf = branchPdfUrl(branch?.id ?? "none", from, to, "filialbericht");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={pdf} className={cx(btn.base, btn.primary, btn.sm, "min-h-11 sm:min-h-9")}>PDF Monatsbericht herunterladen</a>
      {branch && <BranchManageButtons b={branch} onEdit={() => setEdit(true)} from={from} to={to} />}
      {edit && branch && <BranchEditDialog b={branch} onClose={() => setEdit(false)} />}
    </div>
  );
}

function BranchManageButtons({ b, onEdit, compact, from, to }: {
  b: Branch; onEdit: () => void; compact?: boolean; from?: string; to?: string;
}) {
  const router = useRouter();
  const { call, busy, error } = useApi();
  async function remove() {
    const msg = `Filiale „${b.name}“ löschen?\n\nWenn Buchungen vorhanden sind, wird sie nur deaktiviert (historische Berichte bleiben). Leere Filialen werden vollständig entfernt.`;
    if (!confirm(msg)) return;
    const r = await call<{ deleted: boolean; archived: boolean }>("DELETE", `/api/v1/branches/${b.id}`);
    if (r?.deleted && from && to) router.push(`/admin/branches?from=${from}&to=${to}`);
  }
  return (
    <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-1", compact ? "text-xs" : "text-sm")}>
      <button type="button" className="min-h-9 font-medium text-ledger hover:underline" onClick={onEdit}>
        {compact ? "Bearbeiten" : "Filiale bearbeiten / umbenennen"}
      </button>
      {!b.isActive && (
        <button type="button" disabled={busy} className="min-h-9 font-medium text-ledger hover:underline"
          onClick={() => call("PATCH", `/api/v1/branches/${b.id}`, { isActive: true })}>
          Aktivieren
        </button>
      )}
      <button type="button" disabled={busy} className="min-h-9 font-medium text-minus hover:underline" onClick={remove}>
        {compact ? "Löschen" : "Filiale löschen / deaktivieren"}
      </button>
      <ErrorNote error={error} />
    </div>
  );
}

function BranchEditDialog({ b, onClose }: { b: Branch; onClose: () => void }) {
  const { call, busy, error } = useApi();
  const [name, setName] = useState(b.name);
  const [city, setCity] = useState(b.city ?? "");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center" onClick={onClose} role="presentation">
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-4 shadow-lg md:p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="branch-edit-title">
        <h3 id="branch-edit-title" className="text-lg font-semibold">Filiale bearbeiten</h3>
        <p className="mt-1 text-sm text-muted">Name und Ort / Notiz. Historische Buchungen bleiben zugeordnet.</p>
        <form className="mt-4 space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (await call("PATCH", `/api/v1/branches/${b.id}`, { name, city: city || null })) onClose();
        }}>
          <Field label="Name der Filiale">
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} className={inputCls} autoFocus />
          </Field>
          <Field label="Ort / Notiz">
            <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} placeholder="optional" className={inputCls} />
          </Field>
          <ErrorNote error={error} />
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className={cx(btn.base, btn.primary, "flex-1")}>Speichern</button>
            <button type="button" onClick={onClose} className={cx(btn.base, btn.secondary, "flex-1")}>Abbrechen</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Aufklappbare Buchungsliste der ausgewählten Filiale */
export function BranchBookingsPanel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t border-line">
      <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left md:px-5"
        onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="font-semibold">{title} ({count})</span>
        <span className="shrink-0 text-sm font-medium text-ledger">{open ? "Zuklappen" : "Aufklappen"}</span>
      </button>
      {open && children}
    </div>
  );
}
