"use client";

import { useState } from "react";
import Link from "next/link";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function RegisterForm() {
  const { call, busy, error } = useApi();
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await call<{ message: string }>("POST", "/api/v1/auth/register", {
      email: f.get("email"),
      password: f.get("password"),
      companyName: f.get("companyName"),
      name: f.get("name") || undefined,
    }, { refresh: false });
    if (res) setDone(res.message);
  }

  if (done) {
    return (
      <div className="space-y-4 rounded-xl border border-line bg-surface p-5">
        <p className="text-sm leading-relaxed text-ink">{done}</p>
        <p className="text-sm text-muted">
          Du erhältst eine E-Mail, sobald die Systemverwaltung dein Konto freigibt.
        </p>
        <Link href="/login" className={cx(btn.base, btn.primary, "block w-full text-center")}>
          Zur Anmeldung
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <Field label="Firmenname">
        <input name="companyName" required minLength={2} maxLength={120} autoComplete="organization" className={inputCls} />
      </Field>
      <Field label="Dein Name" hint="Optional – sonst Firmenname">
        <input name="name" maxLength={120} autoComplete="name" className={inputCls} />
      </Field>
      <Field label="E-Mail">
        <input name="email" type="email" required autoComplete="email" className={inputCls} />
      </Field>
      <Field label="Passwort" hint="Mindestens 8 Zeichen">
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputCls} />
      </Field>
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>
        {busy ? "Wird gesendet…" : "Registrieren"}
      </button>
    </form>
  );
}
