"use client";

import { useState } from "react";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

type BeginRes = { secret: string; qrDataUrl: string; otpauthUri: string };

export function SecurityTotpPanel({
  totpEnabled,
  totpVerifiedAt,
}: {
  totpEnabled: boolean;
  totpVerifiedAt: string | null;
}) {
  const { call, busy, error, setError } = useApi();
  const [enabled, setEnabled] = useState(totpEnabled);
  const [setup, setSetup] = useState<BeginRes | null>(null);
  const [verifiedAt, setVerifiedAt] = useState(totpVerifiedAt);

  async function startEnroll() {
    const res = await call<BeginRes>("POST", "/api/v1/auth/totp/begin", {}, { refresh: false });
    if (res) setSetup(res);
  }

  async function confirmEnroll(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!setup) return;
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    const res = await call<{ totpEnabled: boolean }>("POST", "/api/v1/auth/totp/confirm", {
      secret: setup.secret, code,
    }, { refresh: false });
    if (res) {
      setEnabled(true);
      setVerifiedAt(new Date().toISOString());
      setSetup(null);
    }
  }

  async function disable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    const res = await call<{ totpEnabled: boolean }>("POST", "/api/v1/auth/totp/disable", { code }, { refresh: false });
    if (res) {
      setEnabled(false);
      setVerifiedAt(null);
      setSetup(null);
    }
  }

  return (
    <section className="max-w-lg space-y-5 rounded-xl border border-line bg-surface p-5 md:p-6">
      <div>
        <h2 className="font-semibold">Zwei-Faktor-Authentifizierung (TOTP)</h2>
        <p className="mt-1 text-sm text-muted">
          Optionaler Schutz mit Google Authenticator, Microsoft Authenticator o. Ä.
          Nach Aktivierung wird beim Login ein 6-stelliger Code verlangt.
        </p>
      </div>

      <p className="text-sm">
        Status:{" "}
        <span className={enabled ? "font-medium text-plus" : "font-medium text-muted"}>
          {enabled ? "Aktiv" : "Nicht eingerichtet"}
        </span>
        {verifiedAt && (
          <span className="text-muted">
            {" "}· seit {new Date(verifiedAt).toLocaleDateString("de-DE")}
          </span>
        )}
      </p>

      <ErrorNote error={error} />

      {!enabled && !setup && (
        <button type="button" disabled={busy} onClick={startEnroll}
          className={cx(btn.base, btn.primary)}>
          {busy ? "Laden…" : "2FA einrichten"}
        </button>
      )}

      {setup && (
        <form onSubmit={confirmEnroll} className="space-y-4 border-t border-line pt-4">
          <p className="text-sm text-muted">
            Scanne den QR-Code mit deiner Authenticator-App, oder trage den Schlüssel manuell ein.
          </p>
          <img src={setup.qrDataUrl} alt="TOTP QR-Code" className="mx-auto h-[220px] w-[220px] rounded-lg border border-line bg-white p-2" />
          <p className="break-all rounded-lg bg-paper px-3 py-2 font-mono text-xs text-muted">{setup.secret}</p>
          <Field label="Bestätigungscode aus der App">
            <input name="code" required pattern="\d{6}" maxLength={6} inputMode="numeric"
              autoComplete="one-time-code" className={cx(inputCls, "font-mono tracking-widest")} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className={cx(btn.base, btn.primary)}>Aktivieren</button>
            <button type="button" className={cx(btn.base, btn.secondary)}
              onClick={() => { setSetup(null); setError(null); }}>
              Abbrechen
            </button>
          </div>
        </form>
      )}

      {enabled && (
        <form onSubmit={disable} className="space-y-3 border-t border-line pt-4">
          <p className="text-sm text-muted">Zum Deaktivieren aktuellen App-Code eingeben.</p>
          <Field label="Code">
            <input name="code" required pattern="\d{6}" maxLength={6} inputMode="numeric"
              autoComplete="one-time-code" className={cx(inputCls, "font-mono tracking-widest")} />
          </Field>
          <button disabled={busy} className={cx(btn.base, "bg-minus text-white hover:opacity-90")}>
            2FA deaktivieren
          </button>
        </form>
      )}
    </section>
  );
}
