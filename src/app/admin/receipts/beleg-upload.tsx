"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BELEG_DOC_TYPE_LABEL, type BelegDocType } from "@/domain/beleg";
import type { BranchOption } from "@/components/branch-category";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function BelegUpload({ branches }: { branches?: BranchOption[] }) {
  const { call, busy, error, setError } = useApi();
  const router = useRouter();
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<BelegDocType>("CASH");
  const [branchId, setBranchId] = useState("");
  const [hint, setHint] = useState<string | null>(null);

  async function upload(file: File | null) {
    if (!file) return;
    setError(null);
    setHint(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("docType", docType);
    if (branchId) fd.set("branchId", branchId);
    const r = await call<{ id: string }>("POST", "/api/v1/belege", fd);
    if (r?.id) {
      setHint("Beleg im Posteingang – OCR läuft im Hintergrund.");
      router.push(`/admin/receipts?tab=inbox&beleg=${r.id}`);
      router.refresh();
    }
  }

  return (
    <div className="mb-5 rounded-xl border-2 border-ledger/40 bg-ledger-soft/40 p-4">
      <p className="mb-3 text-sm font-semibold text-ink">+ Beleg scannen / hochladen</p>
      <div className="mb-3 grid gap-3 sm:grid-cols-2">
        <Field label="Filiale / Standort">
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputCls}>
            <option value="">— keine Filiale (zentral) —</option>
            {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Belegtyp / Ablageort">
          <select value={docType} onChange={(e) => setDocType(e.target.value as BelegDocType)} className={inputCls}>
            {(Object.keys(BELEG_DOC_TYPE_LABEL) as BelegDocType[]).map((k) => (
              <option key={k} value={k}>{BELEG_DOC_TYPE_LABEL[k]}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={cx(btn.base, btn.primary)}
          onClick={() => cam.current?.click()}>Kamera</button>
        <button type="button" disabled={busy} className={cx(btn.base, btn.secondary)}
          onClick={() => gal.current?.click()}>Galerie / PDF</button>
        <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { void upload(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        <input ref={gal} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={(e) => { void upload(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      </div>
      <ErrorNote error={error} />
      {hint && <p className="mt-2 text-sm font-medium text-ledger">{hint}</p>}
      {busy && <p className="mt-2 text-sm text-muted">Wird hochgeladen …</p>}
    </div>
  );
}
