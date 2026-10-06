"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Ruft die REST-API auf und aktualisiert danach die Server-Komponenten.
 * Fehlertexte kommen direkt aus der API (deutsch, verständlich).
 */
export function useApi() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call<T = any>(method: string, url: string, body?: unknown, opts: { refresh?: boolean } = {}): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const isForm = body instanceof FormData;
      const res = await fetch(url, {
        method,
        headers: body && !isForm ? { "content-type": "application/json" } : undefined,
        body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push("/login");
        return null;
      }
      if (!res.ok) {
        setError(data?.error?.message ?? `Fehler ${res.status}`);
        return null;
      }
      if (opts.refresh !== false) router.refresh();
      return data as T;
    } catch {
      setError("Keine Verbindung. Bitte Internet prüfen und erneut versuchen.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { call, busy, error, setError };
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg border border-minus/25 bg-minus-soft px-3 py-2 text-sm text-minus">
      {error}
    </p>
  );
}
