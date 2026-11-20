"use client";

import { useState } from "react";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function CreatePlatformAdminForm() {
  const { call, busy, error } = useApi();
  const [result, setResult] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const el = document.createElement("textarea");
      el.value = text; document.body.appendChild(el); el.select(); document.execCommand("copy"); el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (result) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Platform-Admin angelegt. Passwort jetzt kopieren – es wird nicht erneut angezeigt.
        </p>
        <dl className="space-y-2 rounded-lg bg-paper p-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">E-Mail</dt>
            <dd className="break-all font-medium">{result.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Passwort</dt>
            <dd className="select-all break-all font-mono font-semibold">{result.password}</dd>
          </div>
        </dl>
        <button type="button" className={cx(btn.base, btn.primary, "w-full")} onClick={() => copy(result.password)}>
          {copied ? "Kopiert ✓" : "Passwort kopieren"}
        </button>
        <button type="button" className={cx(btn.base, btn.secondary, "w-full")} onClick={() => setResult(null)}>
          Weiteren anlegen
        </button>
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
      const res = await call<{ admin: { email: string }; password: string }>(
        "POST", "/api/v1/super/admins",
        {
          name: f.name,
          email: f.email,
          password: f.password || undefined,
        },
        { refresh: false },
      );
      if (res) {
        setResult({ email: res.admin.email, password: res.password });
        form.reset();
      }
    }}>
      <p className="text-sm text-muted">
        Platform-Admins sehen alle Firmen unter Systemverwaltung und können Registrierungen freigeben.
      </p>
      <Field label="Name">
        <input name="name" required minLength={2} className={inputCls} placeholder="Noah Al-Samawi" />
      </Field>
      <Field label="E-Mail">
        <input name="email" type="email" required className={inputCls} placeholder="kollege@firma.de" />
      </Field>
      <Field label="Passwort" hint="Optional – leer = zufällig erzeugen">
        <input name="password" type="text" minLength={8} autoComplete="off" className={cx(inputCls, "font-mono")} />
      </Field>
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>
        {busy ? "Anlegen…" : "Platform-Admin anlegen"}
      </button>
    </form>
  );
}
