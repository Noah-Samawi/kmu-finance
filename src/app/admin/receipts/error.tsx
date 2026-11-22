"use client";

import { useEffect } from "react";
import { btn, cx } from "@/components/ui";

export default function ReceiptsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[receipts]", error);
  }, [error]);

  return (
    <div className="rounded-xl border border-minus/30 bg-minus-soft/40 p-6">
      <h2 className="text-lg font-semibold text-minus">Belege prüfen – Fehler</h2>
      <p className="mt-2 text-sm text-ink">
        Die Seite konnte nicht geladen werden. Bitte erneut versuchen.
        {error.digest ? <span className="mt-1 block text-xs text-muted">Digest: {error.digest}</span> : null}
      </p>
      <button type="button" className={cx(btn.base, btn.primary, "mt-4")} onClick={reset}>
        Erneut laden
      </button>
    </div>
  );
}
