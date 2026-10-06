"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { formatCents, parseEuroToCents } from "@/domain/money";

const MAX_BYTES = 10 * 1024 * 1024;

/** Große Handyfotos vor dem Upload verkleinern (spart Datenvolumen, bleibt gut lesbar) */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/heic" || file.type === "image/heif" || file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], "beleg.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

export function ReceiptUpload({ balanceCents, today }: { balanceCents: number; today: string }) {
  const router = useRouter();
  const { call, busy, error, setError } = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  let cents: number | null = null;
  try { cents = amount ? parseEuroToCents(amount) : null; } catch { cents = null; }
  const over = cents !== null && cents > balanceCents;

  async function pick(f: File | undefined) {
    if (!f) return;
    const small = await shrinkImage(f);
    if (small.size > MAX_BYTES) return setError("Datei ist größer als 10 MB");
    setError(null);
    setFile(small);
    setPreview(small.type.startsWith("image/") ? URL.createObjectURL(small) : null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return setError("Bitte zuerst ein Foto vom Beleg machen");
    const fd = new FormData(e.currentTarget);
    fd.set("file", file);
    fd.set("amount", amount);
    const res = await call<{ walletBalanceCents: number }>("POST", "/api/v1/receipts", fd);
    if (res) setDone(res.walletBalanceCents);
  }

  if (done !== null) {
    return (
      <div className="rounded-xl border border-ledger/30 bg-ledger-soft p-5 text-center">
        <p className="text-lg font-semibold text-ledger">Beleg eingereicht</p>
        <p className="mt-1">Neues Guthaben: <span className="font-semibold tabular">{formatCents(done)}</span></p>
        <div className="mt-4 flex flex-col gap-2">
          <button className={cx(btn.base, btn.primary)} onClick={() => { setDone(null); setFile(null); setPreview(null); setAmount(""); }}>Weiteren Beleg einreichen</button>
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

      <Field label="Betrag laut Beleg" hint={`Dein Guthaben: ${formatCents(balanceCents)}`}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} required inputMode="decimal" placeholder="0,00"
          className={cx(inputCls, "h-14 text-right text-2xl font-semibold tabular", over && "border-minus")} />
      </Field>
      {over && <p className="text-sm text-minus">Der Betrag ist höher als dein Guthaben. Bitte melde dich bei der Geschäftsführung.</p>}
      <Field label="Händler"><input name="merchant" required placeholder="z. B. Metro" className={inputCls} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Datum auf dem Bon"><input name="receiptDate" type="date" required max={today} defaultValue={today} className={inputCls} /></Field>
        <Field label="USt. (optional)">
          <select name="vatRate" className={inputCls} defaultValue="">
            <option value="">–</option><option value="1900">19 %</option><option value="700">7 %</option><option value="0">0 %</option>
          </select>
        </Field>
      </div>
      <Field label="Wofür? (optional)"><input name="description" placeholder="z. B. Mehl und Butter" className={inputCls} /></Field>
      <ErrorNote error={error} />
      <button disabled={busy || over || !cents} className={cx(btn.base, btn.primary, "h-14 w-full text-base")}>
        {busy ? "Wird hochgeladen …" : cents ? `${formatCents(cents)} einreichen` : "Beleg einreichen"}
      </button>
    </form>
  );
}
