"use client";

import { useState } from "react";
import { BranchSelect, type BranchOption } from "@/components/branch-category";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { formatCents } from "@/domain/money";

interface UploadResult {
  id: string; lines: number;
  counts: { GREEN: number; BOOKED: number; CASH_WITHDRAWAL: number; RED: number };
  incomeCents: number; expenseCents: number; bankBalanceCents: number;
}

export function BankUpload({ defaultMonth, branches }: { defaultMonth: string; branches?: BranchOption[] }) {
  const { call, busy, error, setError } = useApi();
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setResult(null);
      const form = e.currentTarget;
      const fd = new FormData(form);
      const file = fd.get("file") as File | null;
      if (!file?.size) return setError("Bitte Kontoauszug wählen (CSV, OFX oder PDF)");
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        setProgress("PDF wird gelesen …");
        try {
          const { pdfText } = await import("@/components/ocr");
          const { text } = await pdfText(file, 40);
          if (text.replace(/\s/g, "").length < 30) {
            return setError("PDF ohne lesbaren Text (Scan). Bitte CSV/OFX der Bank oder ein PDF mit Textebene hochladen.");
          }
          fd.set("file", new File([text], file.name.replace(/\.pdf$/i, "") + ".pdf.txt", { type: "text/x-pdf-text" }));
        } catch {
          return setError("PDF konnte nicht gelesen werden. Bitte CSV oder OFX der Bank verwenden.");
        } finally { setProgress(null); }
      }
      const r = await call<UploadResult>("POST", "/api/v1/bank/statements", fd);
      if (r) { setResult(r); form.reset(); }
    }}>
      <Field label="Monat"><input name="periodMonth" type="month" required defaultValue={defaultMonth} className={inputCls} /></Field>
      <BranchSelect branches={branches} hint="Optional – verbuchte Umsätze werden dieser Filiale zugeordnet" />
      <Field label="Datei" hint="CSV (CAMT/MT940-Export), OFX/QFX oder PDF-Kontoauszug">
        <input name="file" type="file" accept=".csv,.ofx,.qfx,.txt,.pdf,text/csv,application/pdf,application/x-ofx" required className="text-sm" />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="autoBook" value="1" defaultChecked className="mt-1 accent-[var(--color-ledger)]" />
        <span>Rote Zeilen automatisch als Tageseinnahme Bankkonto bzw. Ausgabe Bankkonto verbuchen (Ampel wird grün/verbucht).</span>
      </label>
      <ErrorNote error={error} />
      {progress && <p className="text-sm text-muted">{progress}</p>}
      {result && (
        <div className="rounded-lg border border-ledger/30 bg-ledger-soft px-3 py-2 text-sm">
          <p className="font-medium">{`${result.lines} Umsätze: Einnahmen ${formatCents(result.incomeCents)} · Ausgaben ${formatCents(result.expenseCents)}`}</p>
          <p className="text-muted">
            {`Grün ${result.counts.GREEN} · automatisch verbucht ${result.counts.BOOKED} · Geldautomat ${result.counts.CASH_WITHDRAWAL} · offen ${result.counts.RED}`}
          </p>
        </div>
      )}
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>{busy ? "Wird eingelesen …" : "Auszug einlesen und abgleichen"}</button>
    </form>
  );
}
