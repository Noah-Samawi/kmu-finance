"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { useT } from "@/components/i18n";

type LoginRes =
  | { requiresTotp: true; user: { name: string } }
  | { requiresTotp?: false; redirectTo: string };

export function LoginForm() {
  const router = useRouter();
  const { call, busy, error } = useApi();
  const t = useT();
  const [totpStep, setTotpStep] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (totpStep) {
      const res = await call<{ redirectTo: string }>("POST", "/api/v1/auth/totp/verify", {
        code: String(f.get("code") ?? "").trim(),
      }, { refresh: false });
      if (res) router.replace(res.redirectTo);
      return;
    }
    const res = await call<LoginRes>("POST", "/api/v1/auth/login", {
      email: f.get("email"), password: f.get("password"),
    }, { refresh: false });
    if (!res) return;
    if ("requiresTotp" in res && res.requiresTotp) {
      setTotpStep(true);
      return;
    }
    if ("redirectTo" in res) router.replace(res.redirectTo);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-line bg-surface p-5">
      {totpStep ? (
        <>
          <p className="text-sm text-muted">
            Gib den 6-stelligen Code aus deiner Authenticator-App ein.
          </p>
          <Field label="Bestätigungscode">
            <input name="code" inputMode="numeric" autoComplete="one-time-code" required
              pattern="\d{6}" maxLength={6} autoFocus className={cx(inputCls, "tracking-[0.3em] font-mono text-center text-lg")} />
          </Field>
        </>
      ) : (
        <>
          <Field label={t("auth.email")}>
            <input name="email" type="email" autoComplete="username" required className={inputCls} />
          </Field>
          <Field label={t("auth.password")}>
            <input name="password" type="password" autoComplete="current-password" required className={inputCls} />
          </Field>
        </>
      )}
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>
        {busy ? t("auth.loggingIn") : totpStep ? "Bestätigen" : t("auth.login")}
      </button>
      {!totpStep && (
        <div className="flex flex-col gap-2 text-center text-sm text-muted">
          <Link href="/forgot-password" className="hover:text-ink underline-offset-2 hover:underline">
            Passwort vergessen?
          </Link>
          <Link href="/register" className="hover:text-ink underline-offset-2 hover:underline">
            Neues Firmenkonto registrieren
          </Link>
        </div>
      )}
      {totpStep && (
        <button type="button" className="w-full text-sm text-muted hover:text-ink"
          onClick={() => setTotpStep(false)}>
          Zurück zur Anmeldung
        </button>
      )}
    </form>
  );
}
