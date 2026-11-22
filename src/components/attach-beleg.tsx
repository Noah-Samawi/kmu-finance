"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BELEG_DOC_TYPE_LABEL, type BelegDocType } from "@/domain/beleg";
import { formatCents } from "@/domain/money";
import { btn, cx, Empty } from "./ui";
import { ErrorNote, useApi } from "./use-api";

type InboxBeleg = {
  id: string;
  merchant: string | null;
  amountCents: number | null;
  docType: BelegDocType;
  fileMime: string;
  ocrStatus: string;
};

/** Beleg aus Posteingang an bestehende Buchung hängen (ohne Doppelbuchung). */
export function AttachBelegButton({ ledgerEntryId }: { ledgerEntryId: string }) {
  const { call, busy, error, setError } = useApi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<InboxBeleg[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setError(null);
      const r = await call<{ belege: InboxBeleg[] }>("GET", "/api/v1/belege?status=INBOX");
      if (!cancelled && r) setRows(r.belege ?? []);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function pick(belegId: string) {
    if (await call("POST", `/api/v1/belege/${belegId}/attach`, { ledgerEntryId })) {
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <button type="button" disabled={busy} onClick={() => setOpen(true)}
        className="min-h-9 text-sm font-medium text-ledger underline-offset-2 hover:underline">
        Beleg zuordnen
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal>
          <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-semibold">Beleg aus Posteingang wählen</p>
              <button type="button" className={cx(btn.base, btn.sm, btn.secondary)} onClick={() => setOpen(false)}>Schließen</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-3">
              <ErrorNote error={error} />
              {rows === null ? (
                <p className="p-4 text-sm text-muted">Laden …</p>
              ) : rows.length === 0 ? (
                <Empty title="Posteingang leer">
                  <a href="/admin/receipts?tab=inbox" className="text-ledger underline">Beleg scannen / hochladen</a>
                </Empty>
              ) : (
                <ul className="space-y-2">
                  {rows.map((b) => (
                    <li key={b.id}>
                      <button type="button" disabled={busy}
                        onClick={() => void pick(b.id)}
                        className="flex w-full items-center gap-3 rounded-lg border border-line p-2 text-left hover:border-ledger hover:bg-ledger-soft/40">
                        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-paper text-xs text-ledger">
                          {b.fileMime.startsWith("image/") ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`/api/v1/belege/${b.id}/file`} alt="" className="h-full w-full object-cover" />
                          ) : "PDF"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{b.merchant || "Ohne Händler"}</span>
                          <span className="block text-xs text-muted">
                            {BELEG_DOC_TYPE_LABEL[b.docType]}
                            {b.amountCents != null ? ` · ${formatCents(b.amountCents)}` : ""}
                            {b.ocrStatus === "PENDING" ? " · OCR…" : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="border-t border-line px-4 py-2 text-xs text-muted">
              Keine neue Buchung – der Beleg wandert in die Belegablage und wird mit dieser Zeile verknüpft.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

/** Verknüpften Beleg entfernen: nur Datei oder inkl. Buchung. */
export function DetachBelegButton({ ledgerEntryId }: { ledgerEntryId: string }) {
  const { call, busy, error, setError } = useApi();
  const router = useRouter();

  async function run() {
    setError(null);
    const choice = prompt(
      "Verknüpften Beleg entfernen:\n"
      + "1 = nur Datei (Buchung bleibt, Beleg zurück in Posteingang)\n"
      + "2 = Datei + Buchung stornieren\n"
      + "3 = Datei + Buchung löschen\n"
      + "Abbrechen = Esc / leeres Feld",
      "1",
    );
    if (choice === null || choice.trim() === "") return;
    const c = choice.trim();
    let mode: "file" | "reverse" | "remove" = "file";
    let reason: string | undefined;
    if (c === "2" || c.toLowerCase().startsWith("storno")) {
      mode = "reverse";
      const r = prompt("Grund für Storno?");
      if (!r || r.trim().length < 3) return setError("Grund fehlt");
      reason = r.trim();
    } else if (c === "3" || c.toLowerCase().startsWith("lösch")) {
      mode = "remove";
      const r = prompt("Grund für Löschen?");
      if (!r || r.trim().length < 3) return setError("Grund fehlt");
      reason = r.trim();
    } else if (c !== "1" && !c.toLowerCase().startsWith("datei") && !c.toLowerCase().startsWith("nur")) {
      return setError("Bitte 1, 2 oder 3 wählen");
    }
    if (await call("POST", `/api/v1/ledger/${ledgerEntryId}/attachment/detach`, { mode, reason })) {
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" disabled={busy} onClick={() => void run()}
        className="min-h-9 text-sm font-medium text-minus underline-offset-2 hover:underline">
        Beleg entfernen
      </button>
      <ErrorNote error={error} />
    </div>
  );
}
