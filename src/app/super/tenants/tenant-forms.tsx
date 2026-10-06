"use client";

import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

export function CreateTenantForm() {
  const { call, busy, error } = useApi();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const res = await call("POST", "/api/v1/super/tenants", {
      name: f.name, slug: f.slug, legalName: f.legalName || f.name, street: f.street, zip: f.zip, city: f.city,
      taxNumber: f.taxNumber, vatId: f.vatId, iban: f.iban, bic: f.bic,
      smallBusiness: f.smallBusiness === "on",
      admin: { name: f.adminName, email: f.adminEmail, password: f.adminPassword },
    });
    if (res) form.reset();
  }

  const slugify = (v: string) =>
    v.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Firmenname">
        <input name="name" required className={inputCls}
          onChange={(e) => { const s = e.currentTarget.form?.elements.namedItem("slug") as HTMLInputElement; if (s && !s.dataset.touched) s.value = slugify(e.currentTarget.value); }} />
      </Field>
      <Field label="Kurzname (URL)" hint="Kleinbuchstaben, Ziffern und Bindestriche">
        <input name="slug" required pattern="[a-z0-9-]{3,50}" className={inputCls} onInput={(e) => (e.currentTarget.dataset.touched = "1")} />
      </Field>
      <Field label="Rechtlicher Name" hint="Erscheint auf Rechnungen, z. B. „Bäckerei Müller GmbH“">
        <input name="legalName" className={inputCls} />
      </Field>
      <Field label="Straße und Nr."><input name="street" required className={inputCls} /></Field>
      <div className="grid grid-cols-[110px_1fr] gap-3">
        <Field label="PLZ"><input name="zip" required inputMode="numeric" className={inputCls} /></Field>
        <Field label="Ort"><input name="city" required className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Steuernummer"><input name="taxNumber" className={inputCls} /></Field>
        <Field label="USt-IdNr."><input name="vatId" className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <Field label="IBAN"><input name="iban" className={inputCls} /></Field>
        <Field label="BIC"><input name="bic" className={inputCls} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="smallBusiness" className="h-4 w-4 accent-[var(--color-ledger)]" />
        Kleinunternehmer (§ 19 UStG, keine Umsatzsteuer)
      </label>
      <div className="border-t border-line pt-3">
        <p className="mb-2 text-sm font-semibold">Geschäftsführer (erster Admin)</p>
        <div className="space-y-3">
          <Field label="Name"><input name="adminName" required className={inputCls} /></Field>
          <Field label="E-Mail"><input name="adminEmail" type="email" required className={inputCls} /></Field>
          <Field label="Start-Passwort" hint="Mindestens 8 Zeichen"><input name="adminPassword" type="text" minLength={8} required className={inputCls} /></Field>
        </div>
      </div>
      <ErrorNote error={error} />
      <button disabled={busy} className={cx(btn.base, btn.primary, "w-full")}>Mandant anlegen</button>
    </form>
  );
}

export function TenantStatusButton({ id, status }: { id: string; status: "ACTIVE" | "SUSPENDED" }) {
  const { call, busy, error } = useApi();
  const suspend = status === "ACTIVE";
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button disabled={busy} className={cx(btn.base, btn.sm, suspend ? btn.danger : btn.secondary)}
        onClick={() => {
          if (suspend && !confirm("Firma sperren? Alle Benutzer werden sofort abgemeldet.")) return;
          call("PATCH", `/api/v1/super/tenants/${id}`, { status: suspend ? "SUSPENDED" : "ACTIVE" });
        }}>
        {suspend ? "Sperren" : "Freischalten"}
      </button>
      {error && <span className="text-xs text-minus">{error}</span>}
    </span>
  );
}
