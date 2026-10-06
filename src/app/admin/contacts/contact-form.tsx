"use client";

import { useRouter } from "next/navigation";
import { btn, cx, Field, inputCls } from "@/components/ui";
import { ErrorNote, useApi } from "@/components/use-api";

interface Contact {
  id?: string; type: "CUSTOMER" | "SUPPLIER" | "BOTH"; name: string; email: string | null;
  street: string | null; zip: string | null; city: string | null; vatId: string | null; notes: string | null; archived?: boolean;
}

export function ContactForm({ contact }: { contact?: Contact }) {
  const router = useRouter();
  const { call, busy, error } = useApi();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (contact?.id) {
      await call("PATCH", `/api/v1/contacts/${contact.id}`, data);
    } else {
      const res = await call<{ contact: { id: string } }>("POST", "/api/v1/contacts", data, { refresh: false });
      if (res) router.push(`/admin/contacts/${res.contact.id}`);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Name"><input name="name" required defaultValue={contact?.name} className={inputCls} placeholder="z. B. Bäckerei Müller" /></Field>
      <Field label="Art">
        <select name="type" defaultValue={contact?.type ?? "CUSTOMER"} className={inputCls}>
          <option value="CUSTOMER">Kunde</option><option value="SUPPLIER">Lieferant</option><option value="BOTH">Kunde und Lieferant</option>
        </select>
      </Field>
      <Field label="E-Mail"><input name="email" type="email" defaultValue={contact?.email ?? ""} className={inputCls} /></Field>
      <Field label="Straße und Nr."><input name="street" defaultValue={contact?.street ?? ""} className={inputCls} /></Field>
      <div className="grid grid-cols-[110px_1fr] gap-3">
        <Field label="PLZ"><input name="zip" inputMode="numeric" defaultValue={contact?.zip ?? ""} className={inputCls} /></Field>
        <Field label="Ort"><input name="city" defaultValue={contact?.city ?? ""} className={inputCls} /></Field>
      </div>
      <Field label="USt-IdNr." hint="Nur bei Geschäftskunden im Ausland nötig"><input name="vatId" defaultValue={contact?.vatId ?? ""} className={inputCls} /></Field>
      <Field label="Notizen"><textarea name="notes" rows={2} defaultValue={contact?.notes ?? ""} className={cx(inputCls, "h-auto py-2")} /></Field>
      <ErrorNote error={error} />
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} className={cx(btn.base, btn.primary, "flex-1")}>{contact?.id ? "Änderungen speichern" : "Kontakt anlegen"}</button>
        {contact?.id && (
          <button type="button" disabled={busy} className={cx(btn.base, btn.secondary)}
            onClick={() => call("PATCH", `/api/v1/contacts/${contact.id}`, { archived: !contact.archived })}>
            {contact.archived ? "Wiederherstellen" : "Archivieren"}
          </button>
        )}
      </div>
    </form>
  );
}
