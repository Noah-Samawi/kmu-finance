"use client";

import { useState } from "react";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { useT } from "@/components/i18n";
import type { MsgKey } from "@/lib/i18n";

type Kind = "DEPOSIT" | "OUTLAY" | "DRAW";
type Source = "PRIVATE" | "BANK" | "CASH";

const SOURCES: Source[] = ["PRIVATE", "BANK", "CASH"];
const REASON_MIN = 10;

export function SelfBookingForm({ today }: { today: string }) {
  const t = useT();
  const { call, busy, error, setError } = useApi();
  const [kind, setKind] = useState<Kind>("OUTLAY");
  const [source, setSource] = useState<Source | "">("");
  const [hasFile, setHasFile] = useState(false);
  const [saved, setSaved] = useState(false);

  const allowed = (s: Source) => !(kind === "DRAW" && s === "PRIVATE");
  const effect: MsgKey | null = !source ? null
    : kind === "DRAW" ? "pb.effect.DRAW"
    : `pb.effect.${kind}.${source === "PRIVATE" ? "PRIVATE" : "COMPANY"}` as MsgKey;

  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault();
      setSaved(false);
      const form = e.currentTarget;
      const fd = new FormData(form);
      if (!source) return setError(t("pb.source"));
      const purpose = String(fd.get("purpose") ?? "").trim();
      if (!hasFile && purpose.length < REASON_MIN) return setError(`${t("pb.purpose")}: ${t("pb.purposeRequired")}`);
      fd.set("kind", kind);
      fd.set("source", source);
      if (await call("POST", "/api/v1/me/partner-bookings", fd)) {
        form.reset();
        setSource("");
        setHasFile(false);
        setSaved(true);
      }
    }}>
      <Field label={t("pb.kind")}>
        <select value={kind} onChange={(e) => {
          const k = e.target.value as Kind;
          setKind(k);
          if (k === "DRAW" && source === "PRIVATE") setSource("");
        }} className={inputCls}>
          {(["OUTLAY", "DEPOSIT", "DRAW"] as Kind[]).map((k) => <option key={k} value={k}>{t(`pb.kind.${k}` as MsgKey)}</option>)}
        </select>
      </Field>
      <Field label={t("pb.amount")}>
        <input name="amount" required inputMode="decimal" placeholder="0,00" className={cx(inputCls, "text-right tabular")} />
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-sm font-medium">{t("pb.source")}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {SOURCES.map((s) => (
            <label key={s} className={cx(
              "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
              source === s ? "border-ledger bg-ledger/5" : "border-line",
              !allowed(s) && "cursor-not-allowed opacity-50",
            )}>
              <input type="radio" name="sourcePick" value={s} required disabled={!allowed(s)}
                checked={source === s} onChange={() => setSource(s)} />
              <span>{t(`pb.source.${s}` as MsgKey)}{!allowed(s) && ` (${t("pb.sourceNA")})`}</span>
            </label>
          ))}
        </div>
        {effect && <p className="mt-2 text-xs text-muted">{t(effect)}</p>}
      </fieldset>
      <Field label={t("pb.purpose")} hint={hasFile ? t("pb.purposeWithReceipt") : t("pb.purposeRequired")} className="sm:col-span-2">
        <textarea name="purpose" required minLength={hasFile ? 3 : REASON_MIN} maxLength={500} rows={2} dir="auto" className={inputCls} />
      </Field>
      <Field label={t("pb.receipt")}>
        <input name="file" type="file" accept="image/*,application/pdf" className={cx(inputCls, "py-1.5")}
          onChange={(e) => setHasFile(!!e.target.files?.length)} />
      </Field>
      <Field label={t("pb.date")}>
        <input name="bookingDate" type="date" max={today} defaultValue={today} className={inputCls} />
      </Field>
      <div className="sm:col-span-2">
        <ErrorNote error={error} />
        {saved && <p className="mb-2 text-sm text-ledger">{t("pb.saved")}</p>}
        <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>{t("pb.submit")}</button>
      </div>
    </form>
  );
}
