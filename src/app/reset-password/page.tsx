import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "Neues Passwort" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-11 w-11" />
          <div>
            <p className="text-xl font-semibold tracking-tight">Kassenbuch</p>
            <p className="text-sm text-muted">Neues Passwort setzen</p>
          </div>
        </div>
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="rounded-xl border border-line bg-surface p-5 text-sm text-muted">
            Ungültiger oder fehlender Link. Bitte fordere einen neuen Reset-Link an.
          </div>
        )}
        <p className="mt-4 text-center text-sm text-muted">
          <Link href="/login" className="font-medium text-ink underline-offset-2 hover:underline">Zur Anmeldung</Link>
        </p>
      </div>
    </main>
  );
}
