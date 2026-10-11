"use client";

import { useState } from "react";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function LetterheadForm({ tenant }: { tenant: {
  legalName: string; street: string; zip: string; city: string;
  taxNumber: string | null; vatId: string | null; iban: string | null; bic: string | null;
  invoicePrefix: string; defaultPaymentDays: number; invoiceFooter: string | null;
  defaultPaymentMethod: "TRANSFER" | "CASH"; logoKey: string | null;
  bankName?: string | null; invoiceEmail?: string | null; website?: string | null;
  invoiceTagline?: string | null; ownerName?: string | null; smallBusiness?: boolean;
} }) {
  const { call, busy, error } = useApi();
  const [logo, setLogo] = useState(tenant.logoKey ?? "");

  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
      await call("PUT", "/api/v1/settings", {
        legalName: f.legalName, street: f.street, zip: f.zip, city: f.city,
        taxNumber: f.taxNumber || null, vatId: f.vatId || null, iban: f.iban || null, bic: f.bic || null,
        invoicePrefix: f.invoicePrefix, defaultPaymentDays: Number(f.defaultPaymentDays),
        invoiceFooter: f.invoiceFooter || null, defaultPaymentMethod: f.defaultPaymentMethod,
        bankName: f.bankName || null, invoiceEmail: f.invoiceEmail || null, website: f.website || null,
        invoiceTagline: f.invoiceTagline || null, ownerName: f.ownerName || null,
        smallBusiness: f.smallBusiness === "on",
        logoDataUrl: logo || null,
      });
    }}>
      <Field label="Firmenname (Briefkopf)" className="sm:col-span-2"><input name="legalName" dir="auto" defaultValue={tenant.legalName} required className={inputCls} /></Field>
      <Field label="Slogan unter dem Namen" hint="z. B. Küche · Gastronomie · Hospitality"><input name="invoiceTagline" dir="auto" defaultValue={tenant.invoiceTagline ?? ""} className={inputCls} /></Field>
      <Field label="Inhaber / Geschäftsführer"><input name="ownerName" dir="auto" defaultValue={tenant.ownerName ?? ""} className={inputCls} /></Field>
      <Field label="Straße"><input name="street" dir="auto" defaultValue={tenant.street} required className={inputCls} /></Field>
      <Field label="PLZ / Ort" className="grid grid-cols-[100px_1fr] gap-2">
        <input name="zip" defaultValue={tenant.zip} required className={inputCls} />
        <input name="city" dir="auto" defaultValue={tenant.city} required className={inputCls} />
      </Field>
      <Field label="Steuernummer"><input name="taxNumber" defaultValue={tenant.taxNumber ?? ""} className={inputCls} /></Field>
      <Field label="USt-IdNr."><input name="vatId" defaultValue={tenant.vatId ?? ""} className={inputCls} /></Field>
      <Field label="Bank"><input name="bankName" defaultValue={tenant.bankName ?? ""} className={inputCls} /></Field>
      <Field label="IBAN"><input name="iban" defaultValue={tenant.iban ?? ""} className={inputCls} /></Field>
      <Field label="BIC"><input name="bic" defaultValue={tenant.bic ?? ""} className={inputCls} /></Field>
      <Field label="E-Mail (Rechnung)"><input name="invoiceEmail" type="email" defaultValue={tenant.invoiceEmail ?? ""} className={inputCls} /></Field>
      <Field label="Web"><input name="website" defaultValue={tenant.website ?? ""} className={inputCls} placeholder="https://…" /></Field>
      <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm sm:col-span-2">
        <input type="checkbox" name="smallBusiness" defaultChecked={!!tenant.smallBusiness} className="mt-0.5 h-4 w-4 accent-[var(--color-ledger)]" />
        <span>
          <span className="font-semibold">Kleinunternehmer (§ 19 UStG)</span>
          <span className="block text-muted">Nur aktivieren, wenn keine Umsatzsteuer ausgewiesen werden darf – dann sind alle Rechnungspositionen 0 %. Deaktiviert: frei wählbar 0 % bis 20 %.</span>
        </span>
      </label>
      <Field label="Rechnungspräfix"><input name="invoicePrefix" defaultValue={tenant.invoicePrefix} className={inputCls} /></Field>
      <Field label="Zahlungsziel (Tage)"><input name="defaultPaymentDays" type="number" defaultValue={tenant.defaultPaymentDays} className={inputCls} /></Field>
      <Field label="Standard-Zahlungsart">
        <select name="defaultPaymentMethod" defaultValue={tenant.defaultPaymentMethod} className={inputCls}>
          <option value="TRANSFER">Überweisung</option>
          <option value="CASH">Barzahlung</option>
        </select>
      </Field>
      <Field label="Logo (PNG/JPG)" className="sm:col-span-2">
        <input type="file" accept="image/png,image/jpeg" className="text-sm" onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const r = new FileReader();
          r.onload = () => setLogo(String(r.result ?? ""));
          r.readAsDataURL(file);
        }} />
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="Logo" className="mt-2 h-16 object-contain" />
        )}
      </Field>
      <Field label="Fußtext auf Rechnungen" hint="z. B. Handelsregister, Geschäftsführer – erscheint in der Fußzeile jeder Rechnung" className="sm:col-span-2">
        <textarea name="invoiceFooter" defaultValue={tenant.invoiceFooter ?? ""} rows={3} className={cx(inputCls, "h-auto py-2")} placeholder="Amtsgericht … HRB … · Geschäftsführer …" />
      </Field>
      <ErrorNote error={error} />
      <div className="sm:col-span-2"><button disabled={busy} className={cx(btn.base, btn.primary)}>Speichern</button></div>
    </form>
  );
}
