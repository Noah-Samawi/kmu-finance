"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BELEG_DOC_TYPE_LABEL, type BelegDocType } from "@/domain/beleg";
import { formatCents } from "@/domain/money";
import { splitVat } from "@/domain/vat-booking";
import { EXPENSE_CATEGORIES } from "@/domain/cash";
import type { BranchOption } from "@/components/branch-category";
import { VatSelect } from "@/components/vat-select";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

type Line = { amount: string; vatRateBp: number; category: string };

type BelegDetail = {
  id: string;
  status: string;
  docType: BelegDocType;
  branchId: string | null;
  direction: "EXPENSE" | "INCOME" | null;
  accountKind: "CASH" | "BANK" | null;
  amountCents: number | null;
  vatRate: number | null;
  vatMode: "GROSS" | "NET" | null;
  merchant: string | null;
  description: string | null;
  receiptNumber: string | null;
  category: string | null;
  bookingDate: string | Date | null;
  fileMime: string;
  ocrStatus: string;
  lines: { amountCents: number; vatRate: number; category?: string | null }[] | null;
};

function toDateInput(v: string | Date | null | undefined) {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function centsToInput(c: number) {
  return (c / 100).toFixed(2).replace(".", ",");
}

export function BelegReview({
  belegId, branches, today, onClose,
}: {
  belegId: string; branches?: BranchOption[]; today: string; onClose: () => void;
}) {
  const { call, busy, error, setError } = useApi();
  const router = useRouter();
  const [zoom, setZoom] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [accountKind, setAccountKind] = useState<"CASH" | "BANK">("CASH");
  const [branchId, setBranchId] = useState("");
  const [bookingDate, setBookingDate] = useState(today);
  const [merchant, setMerchant] = useState("");
  const [description, setDescription] = useState("");
  const [receiptNumber, setReceiptNumber] = useState("");
  const [vatMode, setVatMode] = useState<"GROSS" | "NET">("GROSS");
  const [lines, setLines] = useState<Line[]>([{ amount: "", vatRateBp: 1900, category: "WAREN" }]);
  const [fileMime, setFileMime] = useState("image/jpeg");
  const [ocrHint, setOcrHint] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const b = await call<BelegDetail>("GET", `/api/v1/belege/${belegId}`);
      if (cancelled || !b) { setLoading(false); return; }
      setFileMime(b.fileMime);
      setDirection(b.direction ?? "EXPENSE");
      setAccountKind(b.accountKind ?? "CASH");
      setBranchId(b.branchId ?? "");
      setBookingDate(toDateInput(b.bookingDate) || today);
      setMerchant(b.merchant ?? "");
      setDescription(b.description ?? "");
      setReceiptNumber(b.receiptNumber ?? "");
      setVatMode(b.vatMode ?? "GROSS");
      setOcrHint(b.ocrStatus === "PENDING" ? "OCR läuft noch…" : b.ocrStatus === "FAILED" ? "OCR fehlgeschlagen – bitte manuell ausfüllen" : "");
      if (b.lines?.length) {
        setLines(b.lines.map((l) => ({
          amount: centsToInput(l.amountCents),
          vatRateBp: l.vatRate,
          category: l.category ?? "WAREN",
        })));
      } else if (b.amountCents) {
        setLines([{
          amount: centsToInput(b.amountCents),
          vatRateBp: b.vatRate ?? 1900,
          category: b.category ?? "WAREN",
        }]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [belegId]);

  const preview = useMemo(() => lines.map((l) => {
    try {
      const raw = l.amount.trim();
      if (!raw) return null;
      const cents = Math.round(Number(raw.replace(",", ".")) * 100);
      if (!Number.isFinite(cents) || cents <= 0) return null;
      return splitVat(cents, l.vatRateBp, vatMode);
    } catch { return null; }
  }), [lines, vatMode]);

  async function book() {
    setError(null);
    const payloadLines = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const cents = Math.round(Number(l.amount.replace(",", ".")) * 100);
      if (!Number.isFinite(cents) || cents <= 0) return setError(`Position ${i + 1}: ungültiger Betrag`);
      payloadLines.push({ amountCents: cents, vatRate: l.vatRateBp / 100, category: l.category });
    }
    if (!merchant.trim()) return setError("Händler / Belegtext fehlt");
    if (!bookingDate) return setError("Datum fehlt");
    const total = payloadLines.reduce((s, l) => s + l.amountCents, 0);
    const r = await call("POST", `/api/v1/belege/${belegId}/book`, {
      direction, accountKind, branchId: branchId || null, bookingDate,
      amountCents: total, vatRate: payloadLines[0].vatRate, vatMode,
      merchant, description: description || null, receiptNumber: receiptNumber || null,
      category: payloadLines[0].category, lines: payloadLines,
    });
    if (r) {
      onClose();
      router.push("/admin/receipts?tab=filed");
      router.refresh();
    }
  }

  async function trash() {
    if (!confirm("Beleg in den Papierkorb?")) return;
    if (await call("POST", "/api/v1/belege/bulk", { action: "trash", ids: [belegId] })) {
      onClose();
      router.refresh();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-ink/40 p-2 md:p-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-surface shadow-xl lg:flex-row">
        <div className="relative flex min-h-[40vh] flex-1 flex-col bg-paper lg:min-h-0">
          <div className="flex items-center gap-2 border-b border-line p-2">
            <button type="button" className={cx(btn.base, btn.sm, btn.secondary)} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>+</button>
            <button type="button" className={cx(btn.base, btn.sm, btn.secondary)} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</button>
            <button type="button" className={cx(btn.base, btn.sm, btn.secondary)} onClick={() => setRotate((r) => r + 90)}>Drehen</button>
            <span className="ml-auto text-xs text-muted">{Math.round(zoom * 100)} %</span>
            <button type="button" className={cx(btn.base, btn.sm, btn.secondary)} onClick={onClose}>Schließen</button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto p-3">
            {fileMime.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/v1/belege/${belegId}/file`}
                alt="Beleg"
                style={{ transform: `scale(${zoom}) rotate(${rotate}deg)`, transformOrigin: "center center" }}
                className="max-h-full max-w-full object-contain transition-transform"
              />
            ) : (
              <iframe title="Beleg" src={`/api/v1/belege/${belegId}/file`} className="h-full min-h-[50vh] w-full rounded border border-line" />
            )}
          </div>
        </div>

        <div className="flex w-full flex-col gap-3 overflow-y-auto border-t border-line p-4 lg:w-[26rem] lg:border-l lg:border-t-0">
          <p className="font-semibold">Beleg prüfen &amp; buchen</p>
          {ocrHint && <p className="text-xs text-amber-700">{ocrHint}</p>}
          {loading ? <p className="text-sm text-muted">Laden …</p> : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={cx(btn.base, btn.sm, direction === "INCOME" ? btn.primary : btn.secondary)}
                  onClick={() => setDirection("INCOME")}>Einnahme</button>
                <button type="button" className={cx(btn.base, btn.sm, direction === "EXPENSE" ? btn.primary : btn.secondary)}
                  onClick={() => setDirection("EXPENSE")}>Ausgabe</button>
              </div>
              <Field label="Konto / Zahlungsweg">
                <select value={accountKind} onChange={(e) => setAccountKind(e.target.value as "CASH" | "BANK")} className={inputCls}>
                  <option value="CASH">Kasse (Bar)</option>
                  <option value="BANK">Bankkonto</option>
                </select>
              </Field>
              <Field label="Filiale / Standort">
                <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputCls}>
                  <option value="">— zentral —</option>
                  {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
              <Field label="Datum">
                <input type="date" max={today} value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Händler / Belegtext">
                <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className={inputCls} dir="auto" />
              </Field>
              <Field label="Beleg-Nr.">
                <input value={receiptNumber} onChange={(e) => setReceiptNumber(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Beschreibung">
                <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} dir="auto" />
              </Field>
              <Field label="Betragsart">
                <select value={vatMode} onChange={(e) => setVatMode(e.target.value as "GROSS" | "NET")} className={inputCls}>
                  <option value="GROSS">Brutto inkl. MwSt.</option>
                  <option value="NET">Netto zzgl. MwSt.</option>
                </select>
              </Field>

              <div className="space-y-3">
                {lines.map((l, i) => (
                  <div key={i} className="rounded-lg border border-line p-2 space-y-2">
                    <p className="text-xs font-medium text-muted">Position {i + 1}</p>
                    <Field label="Betrag (€)">
                      <input value={l.amount} onChange={(e) => setLines((all) => all.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                        inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} />
                    </Field>
                    <Field label="Steuer %">
                      <VatSelect value={l.vatRateBp} onChange={(bp) => setLines((all) => all.map((x, j) => j === i ? { ...x, vatRateBp: bp } : x))} />
                    </Field>
                    {direction === "EXPENSE" && (
                      <Field label="Kategorie">
                        <select value={l.category} onChange={(e) => setLines((all) => all.map((x, j) => j === i ? { ...x, category: e.target.value } : x))} className={inputCls}>
                          {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </Field>
                    )}
                    {preview[i] && (
                      <p className="text-xs text-muted tabular">
                        Netto {formatCents(preview[i]!.netCents)} · MwSt. {formatCents(preview[i]!.vatCents)} · Brutto {formatCents(preview[i]!.grossCents)}
                      </p>
                    )}
                    {lines.length > 1 && (
                      <button type="button" className="text-xs text-minus underline" onClick={() => setLines((all) => all.filter((_, j) => j !== i))}>
                        Position entfernen
                      </button>
                    )}
                  </div>
                ))}
                <button type="button" className={cx(btn.base, btn.sm, btn.secondary, "w-full")}
                  onClick={() => setLines((all) => [...all, { amount: "", vatRateBp: 700, category: "WAREN" }])}>
                  + Belegposition hinzufügen / aufteilen
                </button>
              </div>

              <ErrorNote error={error} />
              <div className="mt-auto flex flex-col gap-2 pt-2">
                <button type="button" disabled={busy} className={cx(btn.base, btn.primary, "w-full")} onClick={() => void book()}>
                  Speichern &amp; Buchen
                </button>
                <button type="button" disabled={busy} className={cx(btn.base, btn.secondary, "w-full")} onClick={onClose}>Abbrechen</button>
                <button type="button" disabled={busy} className={cx(btn.base, btn.danger, "w-full")} onClick={() => void trash()}>Löschen</button>
              </div>
              <p className="text-[10px] text-muted">
                {direction === "INCOME" ? "Einnahme: + auf Kasse/Bank." : "Ausgabe: − auf Kasse/Bank."}
                {" "}Danach → Belegablage. Ablageort: {BELEG_DOC_TYPE_LABEL.CASH} etc. unverändert.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
