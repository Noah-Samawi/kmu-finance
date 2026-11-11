"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { BranchSelect, type BranchOption } from "@/components/branch-category";
import { VatSelect } from "@/components/vat-select";
import { formatCents, parseEuroToCents } from "@/domain/money";
import { fmtDate } from "@/domain/period";
import type { ReceiptSuggestion } from "@/domain/ocr";
import { shrinkImage } from "@/components/shrink-image";

const MAX_BYTES = 10 * 1024 * 1024;

export function ReceiptUpload({ balanceCents, today, branches }: { balanceCents: number; today: string; branches?: BranchOption[] }) {
  const router = useRouter();
  const { call, busy, error, setError } = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(today);
  const [done, setDone] = useState<number | null>(null);
  const [asOutlay, setAsOutlay] = useState(false);
  const [ocr, setOcr] = useState<{ busy: boolean; progress: number; hint: (ReceiptSuggestion & { text: string }) | null }>(
    { busy: false, progress: 0, hint: null },
  );

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  let cents: number | null = null;
  try { cents = amount ? parseEuroToCents(amount) : null; } catch { cents = null; }
  const over = cents !== null && cents > balanceCents && !asOutlay;

  async function pick(f: File | undefined) {
    if (!f) return;
    const small = await shrinkImage(f);
    if (small.size > MAX_BYTES) return setError("Datei ist größer als 10 MB");
    setError(null);
    setFile(small);
    setPreview(small.type.startsWith("image/") ? URL.createObjectURL(small) : null);
    setOcr({ busy: true, progress: 0, hint: null });
    try {
      const { recognizeReceipt } = await import("@/components/ocr");
      const hint = await recognizeReceipt(small, (p) => setOcr((o) => ({ ...o, progress: p })));
      setOcr({ busy: false, progress: 1, hint });
      if (hint.amountCents) setAmount((hint.amountCents / 100).toFixed(2).replace(".", ","));
      if (hint.merchant) setMerchant(hint.merchant);
      if (hint.date && hint.date <= today) setDate(hint.date);
    } catch {
      setOcr({ busy: false, progress: 0, hint: null });
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return setError("Bitte zuerst ein Foto vom Beleg machen");
    const fd = new FormData(e.currentTarget);
    fd.set("file", file);
    fd.set("amount", amount);
    if (asOutlay) fd.set("asOutlay", "true");
    const res = await call<{ walletBalanceCents: number }>("POST", "/api/v1/receipts", fd);
    if (res) setDone(res.walletBalanceCents);
  }

  if (done !== null) {
    return (
      <div className="rounded-xl border border-ledger/30 bg-ledger-soft p-5 text-center">
        <p className="text-lg font-semibold text-ledger">Beleg eingereicht</p>
        <p className="mt-1">Neues Guthaben: <span className="font-semibold tabular">{formatCents(done)}</span></p>
        <div className="mt-4 flex flex-col gap-2">
          <button className={cx(btn.base, btn.primary)} onClick={() => { setDone(null); setFile(null); setPreview(null); setAmount(""); setMerchant(""); setDate(today); setOcr({ busy: false, progress: 0, hint: null }); }}>Weiteren Beleg einreichen</button>
          <button className={cx(btn.base, btn.secondary)} onClick={() => router.push("/me")}>Zum Konto</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input ref={inputRef} type="file" accept="image/*,application/pdf" capture="environment" className="sr-only"
        onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" onClick={() => inputRef.current?.click()}
        className={cx("flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed",
          file ? "border-ledger/40 bg-surface" : "border-line bg-surface text-muted")}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Vorschau des Belegs" className="h-full w-full object-contain" />
        ) : file ? (
          <span className="font-medium text-ledger">{file.name}</span>
        ) : (
          <span className="flex flex-col items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-10 w-10 fill-none stroke-current stroke-[1.5]" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            <span className="font-medium">Foto aufnehmen oder Datei wählen</span>
          </span>
        )}
      </button>
      {file && <button type="button" onClick={() => inputRef.current?.click()} className="text-sm font-medium text-ledger">Anderes Foto wählen</button>}
      {ocr.busy && <p className="text-sm text-muted">Beleg wird analysiert …</p>}
      {ocr.hint && (ocr.hint.amountCents || ocr.hint.merchant) && (
        <p className="rounded-lg border border-ledger/30 bg-ledger-soft px-3 py-2 text-sm">
          {`Erkannt: ${[ocr.hint.merchant, ocr.hint.amountCents && formatCents(ocr.hint.amountCents), ocr.hint.date && fmtDate(new Date(ocr.hint.date + "T12:00:00Z")), ocr.hint.payment === "CASH" ? "Bar" : ocr.hint.payment === "CARD" ? "Karte" : null].filter(Boolean).join(" · ")} – bitte prüfen.`}
        </p>
      )}

      <Field label="Betrag laut Beleg" hint={`Dein Guthaben: ${formatCents(balanceCents)}`}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} required inputMode="decimal" placeholder="0,00"
          className={cx(inputCls, "h-14 text-right text-2xl font-semibold tabular", over && "border-minus")} />
      </Field>
      {over && <p className="text-sm text-minus">Der Betrag ist höher als dein Guthaben. Bitte melde dich bei der Geschäftsführung.</p>}
      <Field label="Händler"><input name="merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} required placeholder="z. B. Metro" className={inputCls} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Datum auf dem Bon"><input name="receiptDate" type="date" required max={today} value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
        <Field label="USt. (optional)">
          <VatSelect name="vatRate" defaultValue="" allowEmpty />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={asOutlay} onChange={(e) => setAsOutlay(e.target.checked)} className="mt-1 accent-[var(--color-ledger)]" />
        <span>Privates Geld ausgelegt (nicht genug Kassenbestand). Wird als Anspruch gegenüber der Firma gebucht.</span>
      </label>
      <BranchSelect branches={branches} />
      <Field label="Wofür? (optional)"><input name="description" placeholder="z. B. Mehl und Butter" className={inputCls} /></Field>
      <ErrorNote error={error} />
      <button disabled={busy || over || !cents} className={cx(btn.base, btn.primary, "h-14 w-full text-base")}>
        {busy ? "Wird hochgeladen …" : cents ? `${formatCents(cents)} einreichen` : "Beleg einreichen"}
      </button>
    </form>
  );
}
