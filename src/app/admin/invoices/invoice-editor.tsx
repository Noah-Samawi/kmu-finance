"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";
import { calcInvoice, calcLine, vatBreakdown } from "@/domain/invoice";
import { centsToPlain, formatCents, formatVatRate, parseEuroToCents } from "@/domain/money";

interface Item { description: string; quantity: string; unit: string; price: string; vatRate: number }
export interface EditorInitial {
  id?: string;
  contactId: string;
  serviceDate: string;
  dueDate: string;
  notes: string;
  items: { description: string; quantity: string; unit: string; unitPriceCents: number; vatRate: number }[];
}

const emptyItem = (): Item => ({ description: "", quantity: "1", unit: "Stk", price: "", vatRate: 700 });

function safeCents(v: string) {
  try { return parseEuroToCents(v || "0"); } catch { return NaN; }
}

export function InvoiceEditor({ contacts, initial, smallBusiness }: {
  contacts: { id: string; name: string }[]; initial?: EditorInitial; smallBusiness: boolean;
}) {
  const router = useRouter();
  const { call, busy, error, setError } = useApi();
  const [contactId, setContactId] = useState(initial?.contactId ?? "");
  const [serviceDate, setServiceDate] = useState(initial?.serviceDate ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
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
    if (!contactId) return setError("Bitte einen Kunden wählen");
    const payload = {
      contactId, serviceDate: serviceDate || null, dueDate: dueDate || null, notes,
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
      <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 md:grid-cols-[2fr_1fr_1fr] md:p-5">
        <Field label="Kunde">
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={inputCls} required>
            <option value="">Bitte wählen …</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Leistungsdatum" hint="Leer = Rechnungsdatum">
          <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Fällig am" hint="Leer = Standard-Zahlungsziel">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </Field>
      </div>

      <div className="rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-4 py-3 font-semibold md:px-5">Positionen</div>
        <div className="divide-y divide-line">
          {items.map((it, idx) => {
            const bad = it.price !== "" && Number.isNaN(safeCents(it.price));
            let line: { lineNetCents: number } | null = null;
            try {
              if (it.price && !bad) line = calcLine({ description: "", quantity: it.quantity.replace(",", ".") || "0", unit: "", unitPriceCents: safeCents(it.price), vatRate: 0 }, 1);
            } catch { line = null; }
            return (
              <div key={idx} className="grid grid-cols-6 gap-2 px-4 py-3 md:grid-cols-[1fr_90px_80px_120px_100px_110px_36px] md:items-end md:px-5">
                <Field label="Beschreibung" className="col-span-6 md:col-span-1">
                  <input value={it.description} onChange={(e) => set(idx, { description: e.target.value })} className={inputCls} placeholder="z. B. Catering 30 Personen" />
                </Field>
                <Field label="Menge" className="col-span-2 md:col-span-1">
                  <input value={it.quantity} inputMode="decimal" onChange={(e) => set(idx, { quantity: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Einheit" className="col-span-2 md:col-span-1">
                  <input value={it.unit} onChange={(e) => set(idx, { unit: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Preis netto" className="col-span-2 md:col-span-1">
                  <input value={it.price} inputMode="decimal" placeholder="0,00" onChange={(e) => set(idx, { price: e.target.value })}
                    className={cx(inputCls, "text-right tabular", bad && "border-minus")} />
                </Field>
                <Field label="USt." className="col-span-3 md:col-span-1">
                  <select value={smallBusiness ? 0 : it.vatRate} disabled={smallBusiness} onChange={(e) => set(idx, { vatRate: Number(e.target.value) })} className={inputCls}>
                    <option value={1900}>19 %</option><option value={700}>7 %</option><option value={0}>0 %</option>
                  </select>
                </Field>
                <div className="col-span-2 self-center text-right md:col-span-1 md:pb-3">
                  <span className="text-xs text-muted md:hidden">Netto </span>
                  <span className="font-medium tabular">{line ? formatCents(line.lineNetCents) : "–"}</span>
                </div>
                <button type="button" aria-label="Position entfernen" onClick={() => setItems((l) => l.length > 1 ? l.filter((_, i) => i !== idx) : [emptyItem()])}
                  className="col-span-1 h-11 self-end rounded-lg text-xl text-muted hover:bg-minus-soft hover:text-minus">×</button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4 md:flex-row md:items-start md:justify-between md:px-5">
          <button type="button" onClick={() => setItems((l) => [...l, emptyItem()])} className={cx(btn.base, btn.ghost, btn.sm, "self-start")}>
            + Position hinzufügen
          </button>
          {calc && (
            <dl className="w-full space-y-1 text-sm md:w-72">
              <div className="flex justify-between"><dt className="text-muted">Netto</dt><dd className="tabular">{formatCents(calc.netCents)}</dd></div>
              {!smallBusiness && vatBreakdown(calc.items).map((v) => (
                <div key={v.rate} className="flex justify-between"><dt className="text-muted">USt. {formatVatRate(v.rate)}</dt><dd className="tabular">{formatCents(v.vat)}</dd></div>
              ))}
              <div className="flex justify-between border-t border-line pt-1 text-base font-semibold"><dt>Gesamt</dt><dd className="tabular">{formatCents(calc.grossCents)}</dd></div>
            </dl>
          )}
        </div>
      </div>

      <Field label="Hinweis auf der Rechnung (optional)">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={cx(inputCls, "h-auto py-2")} placeholder="z. B. Vielen Dank für Ihren Auftrag!" />
      </Field>

      <ErrorNote error={error} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button disabled={busy} onClick={() => save(false)} className={cx(btn.base, btn.secondary)}>Als Entwurf speichern</button>
        <button disabled={busy} onClick={() => save(true)} className={cx(btn.base, btn.primary)}>Speichern und ausstellen</button>
      </div>
    </div>
  );
}
