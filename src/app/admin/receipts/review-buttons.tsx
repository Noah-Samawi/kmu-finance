"use client";

import { btn, cx } from "@/components/ui";
import { useApi } from "@/components/use-api";

export function ReviewButtons({ id, status }: { id: string; status: "SUBMITTED" | "APPROVED" | "REJECTED" }) {
  const { call, busy, error } = useApi();
  if (status === "REJECTED") return null;
  return (
    <div className="flex flex-col items-stretch gap-1">
      <div className="flex gap-2">
        {status === "SUBMITTED" && (
          <button disabled={busy} className={cx(btn.base, btn.primary, btn.sm, "flex-1")}
            onClick={() => call("POST", `/api/v1/receipts/${id}/review`, { action: "approve" })}>Passt</button>
        )}
        <button disabled={busy} className={cx(btn.base, btn.danger, btn.sm, "flex-1")}
          onClick={() => {
            const reason = prompt("Warum wird der Beleg abgelehnt? Der Betrag geht zurück aufs Mitarbeiterkonto.");
            if (reason && reason.trim().length >= 3) call("POST", `/api/v1/receipts/${id}/review`, { action: "reject", reason });
          }}>Ablehnen</button>
      </div>
      {error && <p className="text-xs text-minus">{error}</p>}
    </div>
  );
}
