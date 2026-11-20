"use client";

import { useState } from "react";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function ForgotPasswordForm() {
  const { call, busy, error } = useApi();
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await call<{ message: string }>("POST", "/api/v1/auth/forgot-password", {
      email: f.get("email"),
    }, { refresh: false });
    if (res) setDone(res.message);
  }

  if (done) {
    return (
      <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <p className="text-sm leading-relaxed text-ink">{done}</p>
        <p className="text-sm text-muted">Prüfe auch den Spam-Ordner. Der Link ist eine Stunde gültig.</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <p className="text-sm text-muted">
        Für Konto-Inhaber: Gib deine E-Mail ein. Wenn ein Konto existiert, senden wir einen Reset-Link.
      </p>
      <Field label="E-Mail">
        <input name="email" type="email" required autoComplete="email" className={inputCls} />
      </Field>
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>
        {busy ? "Wird gesendet…" : "Link anfordern"}
      </button>
    </form>
  );
}
