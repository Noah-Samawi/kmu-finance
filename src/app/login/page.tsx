import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Anmelden" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-11 w-11" />
          <div>
            <p className="text-xl font-semibold tracking-tight">Kassenbuch</p>
            <p className="text-sm text-muted">Einnahmen, Budgets und Belege</p>
          </div>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
