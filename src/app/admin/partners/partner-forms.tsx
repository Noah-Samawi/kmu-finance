"use client";

import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function PartnerForms({ partner }: {
  partner?: {
    id: string; name: string; isActive: boolean; canViewReports: boolean; canViewBank: boolean; capitalCents: number;
  };
}) {
  const { call, busy, error } = useApi();
  if (!partner) {
    return (
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
        if (await call("POST", "/api/v1/partners", {
          name: f.name, email: f.email, password: f.password,
          canViewReports: f.canViewReports === "on", canViewBank: f.canViewBank === "on",
        })) form.reset();
      }}>
        <Field label="Name"><input name="name" required className={inputCls} /></Field>
        <Field label="E-Mail"><input name="email" type="email" required className={inputCls} /></Field>
        <Field label="Passwort"><input name="password" type="text" minLength={8} required className={inputCls} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="canViewReports" /> Berichte einsehen</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="canViewBank" /> Kontoauszüge einsehen</label>
        <ErrorNote error={error} />
        <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>Gesellschafter anlegen</button>
      </form>
    );
  }
  return (
    <div className="mt-3 space-y-3">
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        await call("POST", `/api/v1/partners/${partner.id}/book`, {
          type: f.type, amountCents: f.amount, accountKind: f.accountKind, description: f.description,
        });
      }}>
        <Field label="Buchung">
          <select name="type" className={inputCls}>
            <option value="PARTNER_DEPOSIT">Einlage</option>
            <option value="PARTNER_DRAW">Entnahme</option>
            <option value="PARTNER_PROFIT">Gewinnanteil (ohne Auszahlung)</option>
          </select>
        </Field>
        <Field label="Konto">
          <select name="accountKind" className={inputCls}>
            <option value="BANK">Bankkonto</option>
            <option value="CASH">Kasse Bar</option>
          </select>
        </Field>
        <Field label="Betrag"><input name="amount" required inputMode="decimal" className={cx(inputCls, "text-right")} /></Field>
        <Field label="Wofür?"><input name="description" required minLength={3} className={inputCls} dir="auto" /></Field>
        <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm, "sm:col-span-2")}>Buchen</button>
      </form>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} className={cx(btn.base, btn.secondary, btn.sm)}
          onClick={() => call("PATCH", `/api/v1/partners/${partner.id}`, { canViewReports: !partner.canViewReports })}>
          Berichte {partner.canViewReports ? "entziehen" : "geben"}
        </button>
        <button disabled={busy} className={cx(btn.base, btn.secondary, btn.sm)}
          onClick={() => call("PATCH", `/api/v1/partners/${partner.id}`, { canViewBank: !partner.canViewBank })}>
          Bank {partner.canViewBank ? "entziehen" : "geben"}
        </button>
        <button disabled={busy} className={cx(btn.base, btn.sm, partner.isActive ? btn.danger : btn.primary)}
          onClick={() => call("PATCH", `/api/v1/partners/${partner.id}`, { isActive: !partner.isActive })}>
          {partner.isActive ? "Sperren" : "Freischalten"}
        </button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}
