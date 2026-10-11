"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { VatSelect } from "@/components/vat-select";
import Link from "next/link";
import { useT } from "@/components/i18n";
import { calcInvoice, calcLine, DEFAULT_VAT_RATE, vatBreakdown } from "@/domain/invoice";
import { centsToPlain, formatCents, formatVatRate, parseEuroToCents } from "@/domain/money";

interface Item { description: string; quantity: string; unit: string; price: string; vatRate: number }
export interface EditorInitial {
  id?: string;
  contactId: string;
  serviceDate: string;
  dueDate: string;
  notes: string;
  paymentMethod?: "TRANSFER" | "CASH";
  items: { description: string; quantity: string; unit: string; unitPriceCents: number; vatRate: number }[];
}

const emptyItem = (): Item => ({ description: "", quantity: "1", unit: "Stk", price: "", vatRate: DEFAULT_VAT_RATE });

function safeCents(v: string) {
  try { return parseEuroToCents(v || "0"); } catch { return NaN; }
}

export function InvoiceEditor({ contacts, initial, smallBusiness }: {
  contacts: { id: string; name: string }[]; initial?: EditorInitial; smallBusiness: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const { call, busy, error, setError } = useApi();
  const [contactId, setContactId] = useState(initial?.contactId ?? "");
  const [serviceDate, setServiceDate] = useState(initial?.serviceDate ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [paymentMethod, setPaymentMethod] = useState<"TRANSFER" | "CASH">(initial?.paymentMethod ?? "TRANSFER");
  const [items, setItems] = useState<Item[]>(
    initial?.items.length
      ? initial.items.map((i) => ({ description: i.description, quantity: String(Number(i.quantity)).replace(".", ","), unit: i.unit, price: centsToPlain(i.unitPriceCents), vatRate: i.vatRate }))
      : [emptyItem()],
  );

  // Live-Berechnung mit derselben Domain-Logik wie auf dem Server
  const calc = useMemo(() => {
    try {
      const valid = items.filter((i) => i.description && i.price);
      return calcInvoice(valid.map((i) => ({
        description: i.description, quantity: i.quantity.replace(",", ".") || "0", unit: i.unit,
        unitPriceCents: safeCents(i.price), vatRate: i.vatRate,
      })), smallBusiness);
    } catch { return null; }
  }, [items, smallBusiness]);

  const set = (idx: number, patch: Partial<Item>) => setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  async function save(issue: boolean) {
    if (!contactId) return setError(t("inv.needCustomer"));
    const payload = {
      contactId, serviceDate: serviceDate || null, dueDate: dueDate || null, notes, paymentMethod,
      items: items.filter((i) => i.description || i.price).map((i) => ({
        description: i.description, quantity: i.quantity, unit: i.unit, unitPriceCents: i.price, vatRate: i.vatRate,
      })),
    };
    const res = initial?.id
      ? await call<{ invoice: { id: string } }>("PATCH", `/api/v1/invoices/${initial.id}`, payload, { refresh: false })
      : await call<{ invoice: { id: string } }>("POST", "/api/v1/invoices", payload, { refresh: false });
    if (!res) return;
    if (issue) {
      const ok = await call("POST", `/api/v1/invoices/${res.invoice.id}/issue`, undefined, { refresh: false });
      if (!ok) { router.push(`/admin/invoices/${res.invoice.id}`); return; }
    }
    router.push(`/admin/invoices/${res.invoice.id}`);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-[2fr_1fr_1fr_1fr] md:p-5">
        <Field label={t("inv.customer")}>
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputCls} required>
            <option value="">{t("inv.choose")}</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label={t("inv.serviceDate")} hint={t("inv.serviceDateHint")}>
          <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label={t("inv.dueDate")} hint={t("inv.dueDateHint")}>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label={t("inv.paymentMethod")}>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "TRANSFER" | "CASH")} className={inputCls}>
            <option value="TRANSFER">{t("inv.transfer")}</option>
            <option value="CASH">{t("inv.cash")}</option>
          </select>
        </Field>
      </div>

      <div className="rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-4 py-3 font-semibold md:px-5">{t("inv.items")}</div>
        {smallBusiness && (
          <p role="status" className="border-b border-line bg-amber-soft px-4 py-2 text-sm text-amber md:px-5">
            {t("inv.smallBusiness")}{" "}
            <Link href="/admin/briefkopf" className="font-semibold underline">{t("inv.smallBusinessLink")}</Link>
          </p>
        )}
        <div className="divide-y divide-line">
          {items.map((it, idx) => {
            const bad = it.price !== "" && Number.isNaN(safeCents(it.price));
            let line: { lineNetCents: number } | null = null;
            try {
              if (it.price && !bad) line = calcLine({ description: "", quantity: it.quantity.replace(",", ".") || "0", unit: "", unitPriceCents: safeCents(it.price), vatRate: 0 }, 1);
            } catch { line = null; }
            return (
              <div key={idx} className="grid grid-cols-6 gap-2 px-4 py-3 md:grid-cols-[1fr_90px_80px_120px_140px_110px_36px] md:items-end md:px-5">
                <Field label={t("inv.description")} className="col-span-6 md:col-span-1">
                  <input value={it.description} onChange={(e) => set(idx, { description: e.target.value })} className={inputCls} placeholder={t("inv.descriptionPh")} />
                </Field>
                <Field label={t("inv.quantity")} className="col-span-2 md:col-span-1">
                  <input value={it.quantity} inputMode="decimal" onChange={(e) => set(idx, { quantity: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t("inv.unit")} className="col-span-2 md:col-span-1">
                  <input value={it.unit} onChange={(e) => set(idx, { unit: e.target.value })} className={inputCls} />
                </Field>
                <Field label={t("inv.priceNet")} className="col-span-2 md:col-span-1">
                  <input value={it.price} inputMode="decimal" placeholder="0,00" onChange={(e) => set(idx, { price: e.target.value })}
                    className={cx(inputCls, "text-right tabular", bad && "border-minus")} />
                </Field>
                <Field label={t("inv.vat")} className="col-span-3 md:col-span-1">
                  <VatSelect name={`vatRate-${idx}`} value={smallBusiness ? 0 : it.vatRate} disabled={smallBusiness} onChange={(bp) => set(idx, { vatRate: bp })} />
                </Field>
                <div className="col-span-2 self-center text-right md:col-span-1 md:pb-3">
                  <span className="text-xs text-muted md:hidden">{t("inv.net")} </span>
                  <span className="font-medium tabular">{line ? formatCents(line.lineNetCents) : "–"}</span>
                </div>
                <button type="button" aria-label={t("inv.removeItem")} onClick={() => setItems((l) => l.length > 1 ? l.filter((_, i) => i !== idx) : [emptyItem()])}
                  className="col-span-1 h-11 self-end rounded-lg text-xl text-muted hover:bg-minus-soft hover:text-minus">×</button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4 md:flex-row md:items-start md:justify-between md:px-5">
          <button type="button" onClick={() => setItems((l) => [...l, emptyItem()])} className={cx(btn.base, btn.ghost, btn.sm, "self-start")}>
            {t("inv.addItem")}
          </button>
          {calc && (
            <dl className="w-full space-y-1 text-sm md:w-72">
              <div className="flex justify-between"><dt className="text-muted">{t("inv.sumNet")}</dt><dd className="tabular">{formatCents(calc.netCents)}</dd></div>
              {(smallBusiness ? [{ rate: 0, vat: 0 }] : vatBreakdown(calc.items)).map((v) => (
                <div key={v.rate} className="flex justify-between"><dt className="text-muted">{t("inv.vatRow")} {formatVatRate(v.rate)}</dt><dd className="tabular">{formatCents(v.vat)}</dd></div>
              ))}
              <div className="flex justify-between border-t border-line pt-1 text-base font-semibold"><dt>{t("inv.gross")}</dt><dd className="tabular">{formatCents(calc.grossCents)}</dd></div>
            </dl>
          )}
        </div>
      </div>

      <Field label={t("inv.notes")}>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={cx(inputCls, "h-auto py-2")} placeholder={t("inv.notesPh")} />
      </Field>

      <ErrorNote error={error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button disabled={busy} onClick={() => save(false)} className={cx(btn.base, btn.secondary)}>{t("inv.saveDraft")}</button>
        <button disabled={busy} onClick={() => save(true)} className={cx(btn.base, btn.primary)}>{t("inv.saveIssue")}</button>
      </div>
    </div>
  );
}
