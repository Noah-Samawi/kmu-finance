import type { Metadata } from "next";
import Link from "next/link";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Registrieren" };

export default function RegisterPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-11 w-11" />
          <div>
            <p className="text-xl font-semibold tracking-tight">Kassenbuch</p>
            <p className="text-sm text-muted">Firmenkonto anlegen</p>
          </div>
        </div>
        <RegisterForm />
        <p className="mt-4 text-center text-sm text-muted">
          Bereits registriert?{" "}
          <Link href="/login" className="font-medium text-ink underline-offset-2 hover:underline">Anmelden</Link>
        </p>
      </div>
    </main>
  );
}
