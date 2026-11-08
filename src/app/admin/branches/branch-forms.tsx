"use client";

import { useState } from "react";
import { btn, cx, Field, inputCls, Pill } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

interface Branch { id: string; name: string; city: string | null; isActive: boolean }

const SUGGESTED = ["Frankfurt", "Wiesbaden", "Offenbach", "Hamburg", "Eschborn"];

/** Filialen anlegen, umbenennen, deaktivieren */
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
        <Field label="Ort (optional)"><input value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} placeholder="z. B. Frankfurt am Main" className={inputCls} /></Field>
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
  const { call, busy, error } = useApi();
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(b.name);
  return (
    <li className="px-3 py-2 text-sm">
      {edit ? (
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault();
          if (await call("PATCH", `/api/v1/branches/${b.id}`, { name })) setEdit(false);
        }}>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} className={cx(inputCls, "h-9")} />
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>OK</button>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{b.name}{b.city && b.city !== b.name ? <span className="text-muted">{` · ${b.city}`}</span> : null} {!b.isActive && <Pill tone="red">inaktiv</Pill>}</span>
          <span className="flex gap-3 text-xs">
            <button type="button" className="text-ledger hover:underline" onClick={() => setEdit(true)}>Umbenennen</button>
            <button type="button" disabled={busy} className="text-muted hover:text-minus hover:underline"
              onClick={() => call("PATCH", `/api/v1/branches/${b.id}`, { isActive: !b.isActive })}>
              {b.isActive ? "Deaktivieren" : "Aktivieren"}
            </button>
          </span>
        </div>
      )}
      <ErrorNote error={error} />
    </li>
  );
}
