"use client";

import { useState } from "react";
import Link from "next/link";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function ResetPasswordForm({ token }: { token: string }) {
  const { call, busy, error } = useApi();
  const [done, setDone] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password") ?? "");
    const confirm = String(f.get("confirm") ?? "");
    if (password !== confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    const res = await call<{ message: string }>("POST", "/api/v1/auth/reset-password", {
      token, password,
    }, { refresh: false });
    if (res) setDone(res.message);
  }

  if (done) {
    return (
      <div className="space-y-4 rounded-xl border border-line bg-surface p-5">
        <p className="text-sm leading-relaxed text-ink">{done}</p>
        <Link href="/login" className={cx(btn.base, btn.primary, "block w-full text-center")}>
          Anmelden
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <Field label="Neues Passwort" hint="Mindestens 8 Zeichen">
        <input name="password" type="password" required minLength={8} autoComplete="new-password" className={inputCls} />
      </Field>
      <Field label="Passwort wiederholen">
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={inputCls} />
      </Field>
      <ErrorNote error={mismatch ? "Passwörter stimmen nicht überein" : error} />
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>
        {busy ? "Speichern…" : "Passwort speichern"}
      </button>
    </form>
  );
}
