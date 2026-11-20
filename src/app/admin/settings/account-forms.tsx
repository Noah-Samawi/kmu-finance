"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function AccountSettingsForms({ email, name }: { email: string; name: string }) {
  return (
    <div className="grid max-w-xl gap-5">
      <section className="space-y-1 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Konto</h2>
        <p className="text-sm text-muted">{name}</p>
      </section>
      <ChangeEmailForm currentEmail={email} />
      <ChangePasswordForm />
    </div>
  );
}

function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const { call, busy, error } = useApi();
  const [saved, setSaved] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await call<{ email: string }>("PATCH", "/api/v1/auth/account", {
      action: "email",
      email: f.get("email"),
      currentPassword: f.get("currentPassword"),
    });
    if (res) {
      setSaved(res.email);
      e.currentTarget.reset();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">E-Mail ändern</h2>
      <Field label="Aktuelle E-Mail">
        <input value={saved ?? currentEmail} readOnly className={cx(inputCls, "bg-paper text-muted")} />
      </Field>
      <Field label="Neue E-Mail">
        <input name="email" type="email" required autoComplete="email" className={inputCls} />
      </Field>
      <Field label="Aktuelles Passwort zur Bestätigung">
        <input name="currentPassword" type="password" required autoComplete="current-password" className={inputCls} />
      </Field>
      <ErrorNote error={error} />
      {saved && <p className="text-sm text-plus">E-Mail gespeichert: {saved}</p>}
      <button disabled={busy} className={cx(btn.base, btn.primary)}>
        {busy ? "Speichern…" : "E-Mail speichern"}
      </button>
    </form>
  );
}

function ChangePasswordForm() {
  const router = useRouter();
  const { call, busy, error, setError } = useApi();
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const newPassword = String(f.get("newPassword") ?? "");
    const confirm = String(f.get("confirm") ?? "");
    if (newPassword !== confirm) {
      setError("Passwörter stimmen nicht überein");
      return;
    }
    const res = await call<{ message: string }>("PATCH", "/api/v1/auth/account", {
      action: "password",
      currentPassword: f.get("currentPassword"),
      newPassword,
    }, { refresh: false });
    if (res) {
      setDone(true);
      setTimeout(() => router.replace("/login"), 1200);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-line bg-surface p-5 text-sm text-plus">
        Passwort geändert. Weiterleitung zur Anmeldung…
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">Passwort ändern</h2>
      <Field label="Aktuelles Passwort">
        <input name="currentPassword" type="password" required autoComplete="current-password" className={inputCls} />
      </Field>
      <Field label="Neues Passwort" hint="Mindestens 8 Zeichen">
        <input name="newPassword" type="password" required minLength={8} autoComplete="new-password" className={inputCls} />
      </Field>
      <Field label="Neues Passwort wiederholen">
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={inputCls} />
      </Field>
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.primary)}>
        {busy ? "Speichern…" : "Passwort speichern"}
      </button>
    </form>
  );
}
