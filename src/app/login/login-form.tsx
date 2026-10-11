"use client";

import { useRouter } from "next/navigation";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { useT } from "@/components/i18n";

export function LoginForm() {
  const router = useRouter();
  const { call, busy, error } = useApi();
  const t = useT();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await call<{ redirectTo: string }>("POST", "/api/v1/auth/login", {
      email: f.get("email"), password: f.get("password"),
    }, { refresh: false });
    if (res) router.replace(res.redirectTo);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <Field label={t("auth.email")}>
        <input name="email" type="email" autoComplete="username" required className={inputCls} />
      </Field>
      <Field label={t("auth.password")}>
        <input name="password" type="password" autoComplete="current-password" required className={inputCls} />
      </Field>
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>
        {busy ? t("auth.loggingIn") : t("auth.login")}
      </button>
    </form>
  );
}
