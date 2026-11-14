"use client";

import { useState } from "react";
import { BranchSelect, type BranchOption } from "@/components/branch-category";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { formatCents } from "@/domain/money";
import { fmtDate } from "@/domain/period";

interface PreviewLine {
  bookingDate: string; amountCents: number; payee: string; purpose: string;
  status: "GREEN" | "RED" | "CASH_WITHDRAWAL"; matchHint: string | null;
}

interface Preview {
  lines: PreviewLine[];
  openingCents: number | null; closingCents: number | null;
  movementCents: number; computedClosingCents: number | null; balanceOk: boolean | null;
  incomeCents: number; expenseCents: number;
  duplicateFile: boolean; duplicateMonth: boolean;
  source: string; fileSha256: string; fileName: string; fileMime: string; fileB64: string;
}

interface UploadResult {
  id: string; lines: number;
  counts: { GREEN: number; BOOKED: number; CASH_WITHDRAWAL: number; RED: number };
  incomeCents: number; expenseCents: number; bankBalanceCents: number;
}

const STATUS: Record<PreviewLine["status"], string> = {
  GREEN: "schon gebucht", RED: "neu", CASH_WITHDRAWAL: "Geldautomat",
};

/**
 * Kontoauszug: zuerst Vorschau (Ampel, Salden, Duplikate), erst nach Bestätigung buchen.
 * Text-PDFs lokal, Scans/Fotos über KI.
 */
export function BankUpload({ defaultMonth, branches }: { defaultMonth: string; branches?: BranchOption[] }) {
  const { call, busy, error, setError } = useApi();
  const [progress, setProgress] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [month, setMonth] = useState(defaultMonth);
  const [branchId, setBranchId] = useState("");
  const [autoBook, setAutoBook] = useState(true);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function runPreview(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null); setPreview(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file") as File | null;
    if (!file?.size) return setError("Bitte Kontoauszug wählen (CSV, OFX, PDF oder Foto)");
    setProgress(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      ? "Kontoauszug wird gelesen …" : "Datei wird eingelesen …");
    try {
      // Text-PDF zuerst lokal; bei wenig Text schickt der Server die Datei an die KI
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        try {
          const { pdfText } = await import("@/components/ocr");
          const { text } = await pdfText(file, 40);
          if (text.replace(/\s/g, "").length >= 30) {
            fd.set("file", new File([text], file.name.replace(/\.pdf$/i, "") + ".pdf.txt", { type: "text/x-pdf-text" }));
          }
          // sonst Original-PDF lassen → Server macht KI-OCR
        } catch { /* Server-Fallback */ }
      }
      fd.set("periodMonth", month);
      const r = await call<Preview>("POST", "/api/v1/bank/statements", fd, { refresh: false });
      if (r) setPreview(r);
    } finally { setProgress(null); }
  }

  async function confirm(force = false) {
    if (!preview) return;
    const fd = new FormData();
    fd.set("confirm", "1");
    fd.set("periodMonth", month);
    fd.set("fileB64", preview.fileB64);
    fd.set("fileName", preview.fileName);
    fd.set("fileMime", preview.fileMime);
    fd.set("fileSha256", preview.fileSha256);
    if (preview.openingCents != null) fd.set("openingCents", String(preview.openingCents));
    if (preview.closingCents != null) fd.set("closingCents", String(preview.closingCents));
    if (branchId) fd.set("branchId", branchId);
    if (autoBook) fd.set("autoBook", "1");
    if (force) fd.set("force", "1");
    const r = await call<UploadResult>("POST", "/api/v1/bank/statements", fd);
    if (r) { setResult(r); setPreview(null); }
  }

  return (
    <div className="space-y-4">
      <form className="space-y-3" onSubmit={runPreview}>
        <Field label="Monat"><input name="periodMonth" type="month" required value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} /></Field>
        <BranchSelect branches={branches} value={branchId} onChange={setBranchId} hint="Optional – verbuchte Umsätze werden dieser Filiale zugeordnet" />
        <Field label="Datei" hint="CSV / OFX der Bank, PDF-Auszug (Text oder Scan) oder Foto – einzelne Lieferantenrechnungen bitte unter Ausgaben / Eingangsrechnungen">
          <input name="file" type="file" accept=".csv,.ofx,.qfx,.txt,.pdf,image/*,text/csv,application/pdf,application/x-ofx" required className="text-sm" />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={autoBook} onChange={(e) => setAutoBook(e.target.checked)} className="mt-1 accent-[var(--color-ledger)]" />
          <span>Nach Bestätigung: rote Zeilen automatisch als Tageseinnahme bzw. Ausgabe Bankkonto verbuchen.</span>
        </label>
        <ErrorNote error={error} />
        {progress && <p className="text-sm text-muted">{progress}</p>}
        <button disabled={busy} className={cx(btn.base, btn.secondary, "w-full")}>{busy && !preview ? "Wird gelesen …" : "Auszug einlesen (Vorschau)"}</button>
      </form>

      {preview && (
        <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <p className="font-medium">{`${preview.lines.length} Umsätze erkannt (${preview.source})`}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular sm:grid-cols-4">
            <div><dt className="text-muted">Einnahmen</dt><dd className="font-medium">{formatCents(preview.incomeCents)}</dd></div>
            <div><dt className="text-muted">Ausgaben</dt><dd className="font-medium">{formatCents(preview.expenseCents)}</dd></div>
            <div><dt className="text-muted">Anfangssaldo</dt><dd>{preview.openingCents != null ? formatCents(preview.openingCents) : "–"}</dd></div>
            <div><dt className="text-muted">Endsaldo</dt><dd>{preview.closingCents != null ? formatCents(preview.closingCents) : "–"}</dd></div>
          </dl>
          {preview.balanceOk === true && (
            <p className="rounded-lg bg-ledger-soft px-3 py-2 text-sm text-ledger">Saldo-Kontrolle ok: Anfang + Umsätze = Endsaldo.</p>
          )}
          {preview.balanceOk === false && (
            <p className="rounded-lg border border-amber/40 bg-amber-soft px-3 py-2 text-sm text-amber">
              {`Saldo weicht ab: Anfang + Umsätze = ${preview.computedClosingCents != null ? formatCents(preview.computedClosingCents) : "–"}, Auszug nennt ${preview.closingCents != null ? formatCents(preview.closingCents) : "–"}. Bitte prüfen.`}
            </p>
          )}
          {(preview.duplicateFile || preview.duplicateMonth) && (
            <p className="rounded-lg border border-minus/30 bg-minus-soft px-3 py-2 text-sm text-minus">
              {preview.duplicateFile
                ? "Dieser Auszug (gleiche Datei) wurde schon eingelesen."
                : `Für ${month} gibt es bereits einen Kontoauszug.`}
              {" "}Nur bestätigen, wenn Sie bewusst erneut einlesen wollen.
            </p>
          )}
          <div className="max-h-72 overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="sticky top-0 bg-paper text-start text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Datum</th>
                  <th className="px-3 py-2 font-medium">Text</th>
                  <th className="px-3 py-2 font-medium text-right">Betrag</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.lines.map((l, i) => (
                  <tr key={`${l.bookingDate}-${i}`}>
                    <td className="px-3 py-2 whitespace-nowrap text-muted">{fmtDate(new Date(`${l.bookingDate}T12:00:00Z`))}</td>
                    <td className="px-3 py-2"><span className="font-medium">{l.payee || "–"}</span>{l.purpose && <span className="block text-xs text-muted">{l.purpose}</span>}</td>
                    <td className={cx("px-3 py-2 text-right tabular", l.amountCents < 0 && "text-minus")}>{formatCents(l.amountCents)}</td>
                    <td className="px-3 py-2 text-xs">{STATUS[l.status]}{l.matchHint ? ` · ${l.matchHint}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => confirm(preview.duplicateFile || preview.duplicateMonth)}
              className={cx(btn.base, btn.primary, "flex-1")}>
              {busy ? "Wird gebucht …" : "Vorschau bestätigen und buchen"}
            </button>
            <button type="button" disabled={busy} onClick={() => setPreview(null)} className={cx(btn.base, btn.secondary)}>Abbrechen</button>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-ledger/30 bg-ledger-soft px-3 py-2 text-sm">
          <p className="font-medium">{`${result.lines} Umsätze: Einnahmen ${formatCents(result.incomeCents)} · Ausgaben ${formatCents(result.expenseCents)}`}</p>
          <p className="text-muted">
            {`Grün ${result.counts.GREEN} · automatisch verbucht ${result.counts.BOOKED} · Geldautomat ${result.counts.CASH_WITHDRAWAL} · offen ${result.counts.RED}`}
          </p>
        </div>
      )}
    </div>
  );
}
