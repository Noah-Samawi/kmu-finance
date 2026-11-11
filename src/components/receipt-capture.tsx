"use client";

import { useEffect, useRef, useState } from "react";
import { btn, cx } from "@/components/ui";
import { shrinkImage } from "@/components/shrink-image";

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Beleg aufnehmen: großer Kamera-Button (öffnet auf iPhone/Android direkt die Kamera) plus
 * Auswahl aus Fotogalerie / Dateien (Bild oder PDF). Optional mit Miniaturvorschau.
 * Große Fotos werden vor der Weitergabe verkleinert.
 */
export function ReceiptCapture({ file, onFile, onError, analysing, showPreview = true, disabled }: {
  file?: File | null;
  onFile: (f: File | null) => void;
  onError?: (message: string) => void;
  analysing?: boolean;
  showPreview?: boolean;
  disabled?: boolean;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function pick(input: HTMLInputElement) {
    const f = input.files?.[0];
    input.value = ""; // dasselbe Foto darf erneut gewählt werden
    if (!f) return;
    const small = await shrinkImage(f);
    if (small.size > MAX_BYTES) return onError?.("Datei ist größer als 10 MB");
    onFile(small);
  }

  return (
    <div className="space-y-2">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1}
        onChange={(e) => pick(e.currentTarget)} />
      <input ref={gallery} type="file" accept="image/*,application/pdf" className="sr-only" tabIndex={-1}
        onChange={(e) => pick(e.currentTarget)} />
      <button type="button" disabled={disabled || analysing} onClick={() => camera.current?.click()}
        className={cx(btn.base, btn.primary, "h-14 w-full gap-2 text-base")}>
        <span aria-hidden>📷</span> Beleg scannen / Foto aufnehmen
      </button>
      <button type="button" disabled={disabled || analysing} onClick={() => gallery.current?.click()}
        className={cx(btn.base, btn.secondary, "w-full")}>
        Foto oder PDF aus Galerie / Dateien wählen
      </button>

      {analysing && (
        <p role="status" className="flex items-center gap-2 rounded-lg bg-paper px-3 py-2 text-sm text-muted">
          <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin fill-none stroke-current stroke-[3]" aria-hidden>
            <circle cx="12" cy="12" r="9" className="opacity-25" /><path d="M21 12a9 9 0 0 0-9-9" />
          </svg>
          Beleg wird analysiert …
        </p>
      )}

      {showPreview && file && (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2">
          {preview ? (
            <a href={preview} target="_blank" rel="noreferrer" className="shrink-0" aria-label="Belegfoto vergrößern">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Vorschau des Belegs" className="h-20 w-16 rounded-md border border-line bg-paper object-cover" />
            </a>
          ) : (
            <span className="flex h-20 w-16 shrink-0 items-center justify-center rounded-md border border-line bg-paper text-xs font-semibold text-ledger">PDF</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted">{`${(file.size / 1024).toFixed(0)} KB · wird mit der Buchung gespeichert`}</p>
          </div>
          <button type="button" disabled={analysing} onClick={() => onFile(null)} className={cx(btn.base, btn.secondary, btn.sm)}>Entfernen</button>
        </div>
      )}
    </div>
  );
}
