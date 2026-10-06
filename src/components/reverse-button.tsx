"use client";

import { useApi } from "./use-api";

export function ReverseButton({ id }: { id: string }) {
  const { call, busy, error } = useApi();
  return (
    <>
      <button
        disabled={busy}
        className="text-xs font-medium text-muted underline-offset-2 hover:text-minus hover:underline"
        onClick={() => {
          const reason = prompt("Grund für das Storno?");
          if (reason && reason.trim().length >= 3) call("POST", `/api/v1/ledger/${id}/reverse`, { reason });
        }}
      >
        Stornieren
      </button>
      {error && <span className="max-w-48 text-xs text-minus">{error}</span>}
    </>
  );
}
