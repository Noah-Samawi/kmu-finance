"use client";

import { useState } from "react";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { formatCents } from "@/domain/money";

export function CreateEmployeeForm() {
  const { call, busy, error } = useApi();
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      if (await call("POST", "/api/v1/employees", Object.fromEntries(new FormData(form)))) form.reset();
    }}>
      <Field label="Name"><input name="name" required className={inputCls} /></Field>
      <Field label="E-Mail (Login)"><input name="email" type="email" required className={inputCls} /></Field>
      <Field label="Start-Passwort" hint="Mindestens 8 Zeichen. Gib es dem Mitarbeiter persönlich weiter.">
        <input name="password" type="text" minLength={8} required className={inputCls} />
      </Field>
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>Mitarbeiter anlegen</button>
    </form>
  );
}

export function ResetBudgetButton({ id, balanceCents }: { id: string; balanceCents: number }) {
  const { call, busy, error } = useApi();
  const [open, setOpen] = useState(false);
  if (balanceCents <= 0) return null;
  return (
    <div className="space-y-2">
      {!open ? (
        <button type="button" className={cx(btn.base, btn.danger, btn.sm)} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}>
          Budget auf 0,00 € setzen
        </button>
      ) : (
        <form className="space-y-2 rounded-lg border border-minus/30 p-3" onSubmit={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          if (await call("POST", `/api/v1/employees/${id}/reset-budget`, { description: f.description })) setOpen(false);
        }}>
          <p className="text-sm">Guthaben {formatCents(balanceCents)} auf 0,00 € setzen.</p>
          <Field label="Wofür? (Pflicht)"><input name="description" required minLength={3} className={inputCls} dir="auto" placeholder="Begründung" /></Field>
          <div className="flex gap-2">
            <button disabled={busy} className={cx(btn.base, btn.danger, btn.sm)}>Bestätigen</button>
            <button type="button" className={cx(btn.base, btn.secondary, btn.sm)} onClick={() => setOpen(false)}>Abbrechen</button>
          </div>
        </form>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

/** Ausgleich, Rückführung, Sperren, Passwort */
export function WalletActions({ id, balanceCents, isActive, canEnterCashExpense, canEnterOutlay, claimCents, cashCents, bankCents }: {
  id: string; balanceCents: number; isActive: boolean; canEnterCashExpense?: boolean; canEnterOutlay?: boolean;
  claimCents?: number; cashCents?: number; bankCents?: number;
}) {
  const { call, busy, error } = useApi();
  const [mode, setMode] = useState<null | "adjust" | "return" | "password" | "repay" | "credit">(null);
  const toggle = (m: typeof mode) => setMode(mode === m ? null : m);

  return (
    <div className="space-y-3">
      <ResetBudgetButton id={id} balanceCents={balanceCents} />
      <div className="flex flex-wrap gap-2">
        <button className={cx(btn.base, btn.secondary, btn.sm)} disabled={balanceCents <= 0} onClick={() => toggle("adjust")}>Ausgleich buchen</button>
        <button className={cx(btn.base, btn.secondary, btn.sm)} disabled={balanceCents <= 0} onClick={() => toggle("return")}>Restgeld zurücknehmen</button>
        <button className={cx(btn.base, btn.secondary, btn.sm)} onClick={() => toggle("credit")}>Gutschrift / Auslage erfassen</button>
        <button className={cx(btn.base, btn.primary, btn.sm)} disabled={!claimCents || claimCents <= 0} onClick={() => toggle("repay")}>Auslage erstatten</button>
        <button className={cx(btn.base, btn.secondary, btn.sm)} onClick={() => toggle("password")}>Passwort zurücksetzen</button>
        <button disabled={busy} className={cx(btn.base, btn.sm, isActive ? btn.danger : btn.primary)}
          onClick={() => {
            if (isActive && !confirm("Zugang sperren? Der Mitarbeiter wird sofort abgemeldet.")) return;
            call("PATCH", `/api/v1/employees/${id}`, { isActive: !isActive });
          }}>
          {isActive ? "Zugang sperren" : "Zugang freischalten"}
        </button>
        <button disabled={busy} className={cx(btn.base, btn.secondary, btn.sm)}
          onClick={() => call("PATCH", `/api/v1/employees/${id}`, { canEnterCashExpense: !canEnterCashExpense })}>
          {canEnterCashExpense ? "Barausgabe durch MA sperren" : "Barausgabe durch MA erlauben"}
        </button>
        <button disabled={busy} className={cx(btn.base, btn.secondary, btn.sm)}
          onClick={() => call("PATCH", `/api/v1/employees/${id}`, { canEnterOutlay: !canEnterOutlay })}>
          {canEnterOutlay ? "Auslagen durch MA sperren" : "Auslagen durch MA erlauben"}
        </button>
      </div>

      {mode === "adjust" && (
        <form className="space-y-3 rounded-lg border border-line bg-paper p-3" onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          const toZero = f.kind === "zero";
          if (await call("POST", `/api/v1/employees/${id}/adjust`, { toZero, amountCents: toZero ? undefined : f.amount, description: f.description })) setMode(null);
        }}>
          <p className="text-sm text-muted">Für Ausgaben ohne Beleg, z. B. Barzahlung ohne Quittung. Senkt das Guthaben.</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="kind" value="zero" defaultChecked className="accent-[var(--color-ledger)]" /> Auf 0,00 € setzen ({formatCents(balanceCents)})</label>
            <label className="flex items-center gap-2"><input type="radio" name="kind" value="amount" className="accent-[var(--color-ledger)]" /> Betrag:</label>
            <input name="amount" inputMode="decimal" placeholder="0,00" className={cx(inputCls, "h-9 w-28 text-right")} />
          </div>
          <Field label="Wofür? (Pflicht)"><input name="description" required minLength={3} className={inputCls} dir="auto" placeholder="z. B. Parkgebühren ohne Beleg" /></Field>
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>Ausgleich buchen</button>
        </form>
      )}
      {mode === "return" && (
        <form className="space-y-3 rounded-lg border border-line bg-paper p-3" onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          if (await call("POST", `/api/v1/employees/${id}/return`, {
            amountCents: f.amount || undefined, all: !f.amount, accountKind: f.accountKind, description: f.description,
          })) setMode(null);
        }}>
          <p className="text-sm text-muted">Restgeld wird dem Herkunftskonto (Kasse oder Bank) gutgeschrieben, nicht als Ausgabe gebucht.</p>
          <Field label="Herkunftskonto">
            <select name="accountKind" className={inputCls} defaultValue="CASH">
              <option value="CASH">Kasse (Bar){cashCents != null ? ` · ${formatCents(cashCents)}` : ""}</option>
              <option value="BANK">Bankkonto{bankCents != null ? ` · ${formatCents(bankCents)}` : ""}</option>
            </select>
          </Field>
          <Field label="Betrag" hint="Leer lassen = gesamtes Guthaben"><input name="amount" inputMode="decimal" placeholder={formatCents(balanceCents)} className={cx(inputCls, "text-right")} /></Field>
          <Field label="Wofür? (Pflicht)"><input name="description" required minLength={3} className={inputCls} dir="auto" /></Field>
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>Rückgabe buchen</button>
        </form>
      )}
      {mode === "repay" && (
        <form className="space-y-3 rounded-lg border border-line bg-paper p-3" onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          if (await call("POST", `/api/v1/employees/${id}/outlay-repay`, {
            amountCents: f.amount || undefined, all: !f.amount, accountKind: f.accountKind, description: f.description,
          })) setMode(null);
        }}>
          <p className="text-sm text-muted">Offener Anspruch: {formatCents(claimCents ?? 0)}. Zahlung aus Kasse oder Bankkonto, sobald Einnahmen da sind.</p>
          <Field label="Auszahlungskonto">
            <select name="accountKind" className={inputCls} defaultValue="CASH">
              <option value="CASH">Kasse (Bar){cashCents != null ? ` · ${formatCents(cashCents)}` : ""}</option>
              <option value="BANK">Bankkonto{bankCents != null ? ` · ${formatCents(bankCents)}` : ""}</option>
            </select>
          </Field>
          <Field label="Betrag" hint="Leer = gesamter Anspruch"><input name="amount" inputMode="decimal" className={cx(inputCls, "text-right")} /></Field>
          <Field label="Wofür? (Pflicht)"><input name="description" required minLength={3} className={inputCls} dir="auto" /></Field>
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>Erstattung buchen</button>
        </form>
      )}
      {mode === "credit" && (
        <form className="space-y-3 rounded-lg border border-line bg-paper p-3" onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          if (await call("POST", `/api/v1/employees/${id}/outlay`, {
            amountCents: f.amount, description: f.description, bookingDate: f.bookingDate || undefined,
          })) setMode(null);
        }}>
          <p className="text-sm text-muted">Der Mitarbeiter hat privat für die Firma bezahlt: Betrag landet auf seinem Auslagenkonto (Firma schuldet ihm das Geld) – nie im Budget.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Betrag"><input name="amount" required inputMode="decimal" className={cx(inputCls, "text-right")} /></Field>
            <Field label="Datum"><input name="bookingDate" type="date" className={inputCls} /></Field>
          </div>
          <Field label="Wofür? (Pflicht)"><input name="description" required minLength={3} className={inputCls} dir="auto" /></Field>
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>Gutschrift buchen</button>
        </form>
      )}
      {mode === "password" && (
        <form className="space-y-3 rounded-lg border border-line bg-paper p-3" onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          if (await call("PATCH", `/api/v1/employees/${id}`, { password: f.password })) setMode(null);
        }}>
          <Field label="Neues Passwort" hint="Mindestens 8 Zeichen. Laufende Anmeldungen werden beendet.">
            <input name="password" type="text" minLength={8} required className={inputCls} />
          </Field>
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>Passwort setzen</button>
        </form>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
