import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { LanguageSwitcher } from "@/components/i18n";
import { getT } from "@/lib/i18n-server";

export const metadata: Metadata = { title: "Anmelden" };

export default async function LoginPage() {
  const t = await getT();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-11 w-11" />
          <div>
            <p className="text-xl font-semibold tracking-tight">Kassenbuch</p>
            <p className="text-sm text-muted">{t("app.tagline")}</p>
          </div>
        </div>
        <LoginForm />
        <div className="mt-4 flex justify-center"><LanguageSwitcher /></div>
      </div>
    </main>
  );
}
