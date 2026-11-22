"use client";

import { useState } from "react";
import { formatCents, parseEuroToCents } from "@/domain/money";
import { BranchSelect, type BranchOption } from "./branch-category";
import { PersonSelect, type PersonOption } from "./cash-forms";
import { PartnerRoleField } from "./vat-fields";
import { btn, cx, Field, inputCls } from "./ui";
import { ErrorNote, useApi } from "./use-api";

/**
 * Drei Admin-Aktionen je Buchung:
 *  Ändern (Betrag/Zweck/Filiale/Person/Gesellschafter-Art) · Stornieren · Löschen.
 */
export function EntryActions({ id, amountCents, description, branchId, branches, persons, personId, partnerRole, canEdit = true, editHint }: {
  id: string; amountCents: number; description: string; branchId?: string | null; branches?: BranchOption[];
  persons?: PersonOption[]; personId?: string | null; partnerRole?: "FIRMA" | "PRIVAT" | "GEWINN" | "LOHN" | null;
  canEdit?: boolean; editHint?: string;
}) {
  const { call, busy, error, setError } = useApi();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(formatCents(amountCents).replace(/[^\d,.-]/g, ""));
  const [text, setText] = useState(description);
  const [branch, setBranch] = useState(branchId ?? "");
  const [person, setPerson] = useState(personId ?? "");
  const [role, setRole] = useState<"" | "FIRMA" | "PRIVAT" | "GEWINN" | "LOHN">(partnerRole ?? "");
  const [reason, setReason] = useState("");
  const selected = persons?.find((p) => p.id === person);
  const isPartner = selected?.role === "PARTNER";

  const ask = (q: string) => {
    const r = prompt(q);
    if (r === null) return null;
    if (r.trim().length < 3) { setError("Bitte einen Grund angeben (mind. 3 Zeichen)"); return null; }
    return r.trim();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-sm font-medium">
        {canEdit && (
          <button type="button" disabled={busy} title={editHint} onClick={() => { setEditing((v) => !v); setError(null); }}
            className="min-h-9 text-ledger underline-offset-2 hover:underline">Ändern</button>
        )}
        <button type="button" disabled={busy} className="min-h-9 text-muted underline-offset-2 hover:text-minus hover:underline"
          onClick={() => { const r = ask("Stornieren (Gegenbuchung, bleibt sichtbar) – Grund?"); if (r) call("POST", `/api/v1/ledger/${id}/reverse`, { reason: r }); }}>
          Stornieren
        </button>
        <button type="button" disabled={busy} className="min-h-9 text-minus underline-offset-2 hover:underline"
          onClick={() => {
            if (!confirm(`Buchung über ${formatCents(amountCents)} komplett entfernen? Der Kontostand wird neu berechnet.`)) return;
            const r = ask("Löschen – Grund?");
            if (r) call("POST", `/api/v1/ledger/${id}/remove`, { reason: r });
          }}>
          Löschen
        </button>
      </div>
      {editing && (
        <form className="mt-1 w-80 space-y-2 rounded-lg border border-line bg-paper p-3 text-left" onSubmit={async (e) => {
          e.preventDefault();
          let cents: number;
          try { cents = parseEuroToCents(amount); } catch { return setError("Ungültiger Betrag"); }
          if (!Number.isInteger(cents) || cents <= 0) return setError("Betrag muss größer als 0 sein");
          if (isPartner && !role) return setError("Bitte Art der Gesellschafter-Buchung wählen");
          const personChanged = (personId ?? "") !== person;
          const roleChanged = (partnerRole ?? "") !== role;
          const r = await call("POST", `/api/v1/ledger/${id}/edit`, {
            amountCents: cents === amountCents ? undefined : cents,
            description: text.trim() === description.trim() ? undefined : text.trim(),
            branchId: (branchId ?? "") === branch ? undefined : branch || null,
            personId: personChanged ? (person || null) : undefined,
            partnerRole: roleChanged || (isPartner && personChanged) ? (role || null) : undefined,
            reason,
          });
          if (r) setEditing(false);
        }}>
          <Field label={`Betrag (bisher ${formatCents(amountCents)})`}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required className={cx(inputCls, "text-right tabular")} />
          </Field>
          <Field label="Verwendungszweck">
            <input value={text} onChange={(e) => setText(e.target.value)} className={inputCls} dir="auto" />
          </Field>
          <BranchSelect branches={branches} value={branch} onChange={setBranch} />
          {persons && persons.length > 0 && (
            <PersonSelect persons={persons} value={person} onChange={(id) => { setPerson(id); if (!persons.find((p) => p.id === id && p.role === "PARTNER")) setRole(""); }} />
          )}
          <PartnerRoleField
            show={!!isPartner || selected?.role === "EMPLOYEE"}
            mode={isPartner ? "partner" : "employee"}
            value={role}
            onChange={setRole}
          />
          <Field label="Grund der Änderung">
            <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} placeholder="z. B. Gesellschafter nachträglich zuordnen" className={inputCls} />
          </Field>
          <div className="flex gap-2">
            <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm, "flex-1")}>Speichern</button>
            <button type="button" onClick={() => setEditing(false)} className={cx(btn.base, btn.secondary, btn.sm)}>Abbrechen</button>
          </div>
        </form>
      )}
      <div className="max-w-80"><ErrorNote error={error} /></div>
    </div>
  );
}
