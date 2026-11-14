"use client";

import { useState } from "react";
import { BranchSelect, type BranchOption } from "@/components/branch-category";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { formatCents } from "@/domain/money";

/** Neuer Mitarbeiter: Stammdaten ohne Login-Pflicht; Login nur für Außendienst mit Budget */
export function CreateEmployeeForm({ branches }: { branches?: BranchOption[] }) {
  const { call, busy, error } = useApi();
  const [withLogin, setWithLogin] = useState(false);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
      if (await call("POST", "/api/v1/employees", {
        ...f, withLogin,
        monthlyGrossCents: f.monthlyGross || undefined,
        password: withLogin ? f.password : undefined,
        email: withLogin ? f.email : undefined,
      })) {
        form.reset();
        setWithLogin(false);
      }
    }}>
      <Field label="Name"><input name="name" required minLength={2} className={inputCls} /></Field>
      <Field label="Position / Tätigkeit"><input name="jobTitle" placeholder="z. B. Fahrer, Koch" className={inputCls} /></Field>
      <Field label="Telefon"><input name="phone" type="tel" className={inputCls} /></Field>
      <Field label="Straße und Nr."><input name="street" className={inputCls} /></Field>
      <div className="grid grid-cols-[110px_1fr] gap-2">
        <Field label="PLZ"><input name="zip" className={inputCls} /></Field>
        <Field label="Ort"><input name="city" className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Geburtsdatum"><input name="dateOfBirth" type="date" className={inputCls} /></Field>
        <Field label="Eintritt"><input name="startDate" type="date" className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Steuer-ID"><input name="taxId" className={inputCls} /></Field>
        <Field label="SV-Nummer"><input name="socialSecurityNumber" className={inputCls} /></Field>
      </div>
      <Field label="IBAN"><input name="iban" className={inputCls} /></Field>
      <Field label="Gehalt brutto / Monat (€)"><input name="monthlyGross" inputMode="decimal" placeholder="0,00" className={inputCls} /></Field>
      <BranchSelect branches={branches} />

      <label className="flex items-start gap-2 rounded-lg border border-line bg-paper px-3 py-2 text-sm">
        <input type="checkbox" checked={withLogin} onChange={(e) => setWithLogin(e.target.checked)} className="mt-1 accent-[var(--color-ledger)]" />
        <span>
          <span className="font-medium">Login für Außendienst (Fahrer / Einkäufer mit Budget-Konto)</span>
          <span className="block text-xs text-muted">Nur dann E-Mail und Passwort – Küche/Service braucht keinen Zugang.</span>
        </span>
      </label>
      {withLogin && (
        <>
          <Field label="E-Mail (Login)"><input name="email" type="email" required={withLogin} className={inputCls} /></Field>
          <Field label="Start-Passwort" hint="Mindestens 8 Zeichen. Persönlich weitergeben.">
            <input name="password" type="text" minLength={8} required={withLogin} className={inputCls} />
          </Field>
        </>
      )}
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

/** Lohn auszahlen + Löschen / Deaktivieren */
export function EmployeeManageActions({ id, name, isActive, cashCents = 0, bankCents = 0 }: {
  id: string; name: string; isActive: boolean; cashCents?: number; bankCents?: number;
}) {
  const { call, busy, error, setError } = useApi();
  const [mode, setMode] = useState<null | "wage" | "delete">(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <a href={`/admin/employees/${id}`} className={cx(btn.base, btn.secondary, btn.sm)}>Bearbeiten / Personalakte</a>
        <button type="button" className={cx(btn.base, btn.primary, btn.sm)} onClick={() => setMode(mode === "wage" ? null : "wage")}>Lohn auszahlen</button>
        <button type="button" disabled={busy} className={cx(btn.base, btn.sm, isActive ? btn.secondary : btn.primary)}
          onClick={() => {
            if (isActive && !confirm("Mitarbeiter deaktivieren? Zugang und Login werden gesperrt.")) return;
            call("PATCH", `/api/v1/employees/${id}`, { isActive: !isActive, canLogin: !isActive ? undefined : false });
          }}>
          {isActive ? "Deaktivieren" : "Reaktivieren"}
        </button>
        <button type="button" className={cx(btn.base, btn.danger, btn.sm)} onClick={() => setMode(mode === "delete" ? null : "delete")}>Löschen</button>
      </div>

      {mode === "wage" && (
        <form className="space-y-3 rounded-lg border border-line bg-paper p-3" onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          if (await call("POST", `/api/v1/employees/${id}/wage`, fd)) setMode(null);
        }}>
          <p className="text-sm font-medium">Lohn auszahlen / überweisen – {name}</p>
          <Field label="Betrag"><input name="amount" required inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} /></Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Auszahlung von</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="fund" value="CASH" defaultChecked className="accent-[var(--color-ledger)]" />
              Kasse (Bar) · Bestand {formatCents(cashCents)}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="fund" value="BANK" className="accent-[var(--color-ledger)]" />
              Bankkonto · Bestand {formatCents(bankCents)}
            </label>
          </fieldset>
          <Field label="Datum"><input name="bookingDate" type="date" className={inputCls} /></Field>
          <Field label="Hinweis (optional)"><input name="description" placeholder="z. B. Lohn November" className={inputCls} /></Field>
          <Field label="Nachweis (optional)"><input name="file" type="file" accept="image/*,application/pdf" className="text-sm" /></Field>
          <div className="flex gap-2">
            <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>Auszahlen &amp; buchen</button>
            <button type="button" className={cx(btn.base, btn.secondary, btn.sm)} onClick={() => setMode(null)}>Abbrechen</button>
          </div>
        </form>
      )}

      {mode === "delete" && (
        <form className="space-y-2 rounded-lg border border-minus/30 bg-minus-soft p-3" onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          if (f.confirm.trim() !== name) return setError(`Bitte exakt „${name}“ eintippen`);
          if (await call("DELETE", `/api/v1/employees/${id}`, { confirm: f.confirm })) setMode(null);
        }}>
          <p className="text-sm">Mitarbeiter <strong>{name}</strong> löschen? Mit vorhandenen Buchungen wird nur deaktiviert (GoBD).</p>
          <Field label={`Zur Bestätigung „${name}“ eintippen`}>
            <input name="confirm" required autoComplete="off" className={inputCls} />
          </Field>
          <div className="flex gap-2">
            <button disabled={busy} className={cx(btn.base, btn.danger, btn.sm)}>Endgültig löschen</button>
            <button type="button" className={cx(btn.base, btn.secondary, btn.sm)} onClick={() => setMode(null)}>Abbrechen</button>
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
        <button className={cx(btn.base, btn.secondary, btn.sm)} onClick={() => toggle("password")}>Passwort / Login freischalten</button>
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
            <label className="flex items-center gap-2"><input type="radio" name="kind" value="partial" defaultChecked /> Teilbetrag</label>
            <label className="flex items-center gap-2"><input type="radio" name="kind" value="zero" /> Komplett auf 0</label>
          </div>
          <Field label="Betrag"><input name="amount" inputMode="decimal" placeholder="0,00" className={inputCls} /></Field>
          <Field label="Wofür?"><input name="description" required minLength={3} className={inputCls} /></Field>
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>Buchen</button>
        </form>
      )}
      {mode === "return" && (
        <form className="space-y-3 rounded-lg border border-line bg-paper p-3" onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          if (await call("POST", `/api/v1/employees/${id}/return`, { amountCents: f.amount || undefined, description: f.description, accountKind: f.accountKind })) setMode(null);
        }}>
          <Field label="Betrag (leer = alles)"><input name="amount" inputMode="decimal" className={inputCls} /></Field>
          <Field label="Zurück auf">
            <select name="accountKind" defaultValue="CASH" className={inputCls}>
              <option value="CASH">Kasse (Bar){cashCents != null ? ` · ${formatCents(cashCents)}` : ""}</option>
              <option value="BANK">Bankkonto{bankCents != null ? ` · ${formatCents(bankCents)}` : ""}</option>
            </select>
          </Field>
          <Field label="Wofür?"><input name="description" required minLength={3} className={inputCls} /></Field>
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>Zurücknehmen</button>
        </form>
      )}
      {mode === "credit" && (
        <form className="space-y-3 rounded-lg border border-line bg-paper p-3" onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          if (await call("POST", `/api/v1/employees/${id}/outlay`, { amountCents: f.amount, description: f.description })) setMode(null);
        }}>
          <Field label="Betrag"><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
          <Field label="Wofür?"><input name="description" required minLength={3} className={inputCls} /></Field>
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>Erfassen</button>
        </form>
      )}
      {mode === "repay" && (
        <form className="space-y-3 rounded-lg border border-line bg-paper p-3" onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          if (await call("POST", `/api/v1/employees/${id}/outlay-repay`, { amountCents: f.amount || undefined, accountKind: f.accountKind, description: f.description })) setMode(null);
        }}>
          <Field label="Betrag (leer = alles)"><input name="amount" inputMode="decimal" className={inputCls} /></Field>
          <Field label="Auszahlen von">
            <select name="accountKind" defaultValue="CASH" className={inputCls}>
              <option value="CASH">Kasse (Bar)</option>
              <option value="BANK">Bankkonto</option>
            </select>
          </Field>
          <Field label="Wofür?"><input name="description" required minLength={3} className={inputCls} /></Field>
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>Erstatten</button>
        </form>
      )}
      {mode === "password" && (
        <form className="space-y-3 rounded-lg border border-line bg-paper p-3" onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          if (await call("PATCH", `/api/v1/employees/${id}`, { password: f.password, canLogin: true, email: f.email || undefined })) setMode(null);
        }}>
          <p className="text-sm text-muted">Setzt ein Login-Passwort und schaltet den Zugang frei (für Außendienst).</p>
          <Field label="E-Mail (falls noch kein Login)"><input name="email" type="email" className={inputCls} /></Field>
          <Field label="Neues Passwort"><input name="password" type="text" minLength={8} required className={inputCls} /></Field>
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm)}>Speichern</button>
        </form>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
