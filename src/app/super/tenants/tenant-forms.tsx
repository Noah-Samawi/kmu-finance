"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/modal";
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

export interface TenantRow {
  id: string; name: string; slug: string; status: "ACTIVE" | "SUSPENDED";
  legalName: string; street: string; zip: string; city: string;
  taxNumber: string | null; vatId: string | null; iban: string | null; bic: string | null;
  smallBusiness: boolean; adminEmail: string | null; adminName: string | null;
}

type Dialog = "password" | "edit" | "delete" | null;

/** „⋮“-Aktionsmenü je Firma: Passwort, Sperren/Entsperren, Bearbeiten, Löschen */
export function TenantActions({ t }: { t: TenantRow }) {
  const { call, busy, error } = useApi();
  const [menu, setMenu] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const suspend = t.status === "ACTIVE";

  function toggleMenu(e: React.MouseEvent<HTMLButtonElement>) {
    if (menu) return setMenu(null);
    const r = e.currentTarget.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    // reicht der Platz nach unten nicht, nach oben öffnen
    setMenu(r.bottom + 230 > window.innerHeight
      ? { bottom: window.innerHeight - r.top + 4, right }
      : { top: r.bottom + 4, right });
  }
  const pick = (d: Dialog) => { setMenu(null); setDialog(d); };
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("keydown", onKey); window.removeEventListener("resize", close); };
  }, [menu]);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" aria-label={`Aktionen für ${t.name}`} aria-haspopup="menu" aria-expanded={!!menu}
        onClick={toggleMenu} disabled={busy}
        className={cx(btn.base, btn.secondary, btn.sm, "w-11 px-0 text-lg leading-none")}>
        ⋮
      </button>
      {error && <span className="max-w-48 text-xs text-minus">{error}</span>}

      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} role="presentation" />
          <div role="menu" style={{ top: menu.top, bottom: menu.bottom, right: menu.right }}
            className="fixed z-50 w-60 overflow-hidden rounded-xl border border-line bg-surface py-1 text-start shadow-lg">
            <MenuItem onClick={() => pick("password")}>Passwort zurücksetzen</MenuItem>
            <MenuItem onClick={() => {
              setMenu(null);
              if (suspend && !confirm(`Firma „${t.name}“ sperren? Alle Benutzer werden sofort abgemeldet.`)) return;
              call("PATCH", `/api/v1/super/tenants/${t.id}`, { status: suspend ? "SUSPENDED" : "ACTIVE" });
            }}>{suspend ? "Sperren" : "Entsperren"}</MenuItem>
            <MenuItem onClick={() => pick("edit")}>Bearbeiten</MenuItem>
            <div className="my-1 border-t border-line" />
            <MenuItem danger onClick={() => pick("delete")}>Firma löschen</MenuItem>
          </div>
        </>
      )}

      {dialog === "password" && <PasswordDialog t={t} onClose={() => setDialog(null)} />}
      {dialog === "edit" && <EditDialog t={t} onClose={() => setDialog(null)} />}
      {dialog === "delete" && <DeleteDialog t={t} onClose={() => setDialog(null)} />}
    </span>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      className={cx("flex min-h-11 w-full items-center px-4 text-start text-[15px] font-medium hover:bg-paper",
        danger ? "text-minus hover:bg-minus-soft" : "text-ink")}>
      {children}
    </button>
  );
}

// Ohne leicht verwechselbare Zeichen (0/O, 1/l/I)
const PW_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function randomPassword(length = 14) {
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => PW_CHARS[n % PW_CHARS.length]).join("");
}

function PasswordDialog({ t, onClose }: { t: TenantRow; onClose: () => void }) {
  const { call, busy, error } = useApi();
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<{ adminEmail: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const el = document.createElement("textarea");
      el.value = text; document.body.appendChild(el); el.select(); document.execCommand("copy"); el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (result) {
    return (
      <Modal title="Neues Passwort gesetzt" onClose={onClose}>
        <p className="mt-1 text-sm text-muted">Bitte jetzt kopieren und dem Mandanten mitteilen – es wird nicht erneut angezeigt. Alle bisherigen Sitzungen des Admins wurden beendet.</p>
        <dl className="mt-4 space-y-2 rounded-lg bg-paper p-3 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-muted">Firma</dt><dd className="font-medium">{t.name}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">Benutzer</dt><dd className="break-all font-medium">{result.adminEmail}</dd></div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Passwort</dt>
            <dd className="select-all break-all font-mono text-base font-semibold">{result.password}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={cx(btn.base, btn.primary, "flex-1")} onClick={() => copy(result.password)}>
            {copied ? "Kopiert ✓" : "Passwort kopieren"}
          </button>
          <button type="button" className={cx(btn.base, btn.secondary, "flex-1")} onClick={onClose}>Schließen</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Passwort zurücksetzen" onClose={onClose}>
      <p className="mt-1 text-sm text-muted">
        Neues Passwort für den Admin / Geschäftsführer von <strong>{t.name}</strong>
        {t.adminEmail ? <> ({t.adminEmail})</> : null}.
      </p>
      {!t.adminEmail ? <div className="mt-3"><ErrorNote error="Diese Firma hat keinen Admin-Benutzer." /></div> : (
        <form className="mt-4 space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          const res = await call<{ adminEmail: string; password: string }>(
            "POST", `/api/v1/super/tenants/${t.id}/admin-password`, password ? { password } : {}, { refresh: false });
          if (res) setResult(res);
        }}>
          <Field label="Neues Passwort" hint="Mindestens 8 Zeichen – oder leer lassen / zufällig erzeugen">
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="text" minLength={8} autoComplete="off"
              spellCheck={false} placeholder="leer = zufälliges Passwort" className={cx(inputCls, "font-mono")} />
          </Field>
          <button type="button" className={cx(btn.base, btn.secondary, btn.sm)} onClick={() => setPassword(randomPassword())}>
            Zufälliges Passwort generieren
          </button>
          <ErrorNote error={error} />
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className={cx(btn.base, btn.primary, "flex-1")}>Passwort setzen</button>
            <button type="button" onClick={onClose} className={cx(btn.base, btn.secondary, "flex-1")}>Abbrechen</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function EditDialog({ t, onClose }: { t: TenantRow; onClose: () => void }) {
  const { call, busy, error } = useApi();
  return (
    <Modal title="Firma bearbeiten" onClose={onClose}>
      <p className="mt-1 text-sm text-muted">Stammdaten von <strong>{t.name}</strong>. Der Kurzname ({t.slug}) bleibt unverändert.</p>
      <form className="mt-4 space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
        const ok = await call("PATCH", `/api/v1/super/tenants/${t.id}`, {
          name: f.name, legalName: f.legalName, street: f.street, zip: f.zip, city: f.city,
          taxNumber: f.taxNumber, vatId: f.vatId, iban: f.iban, bic: f.bic, smallBusiness: f.smallBusiness === "on",
        });
        if (ok) onClose();
      }}>
        <Field label="Firmenname"><input name="name" required minLength={2} defaultValue={t.name} className={inputCls} /></Field>
        <Field label="Rechtlicher Name"><input name="legalName" required minLength={2} defaultValue={t.legalName} className={inputCls} /></Field>
        <Field label="Straße und Nr."><input name="street" required defaultValue={t.street} className={inputCls} /></Field>
        <div className="grid grid-cols-[110px_1fr] gap-3">
          <Field label="PLZ"><input name="zip" required minLength={4} defaultValue={t.zip} inputMode="numeric" className={inputCls} /></Field>
          <Field label="Ort"><input name="city" required defaultValue={t.city} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Steuernummer"><input name="taxNumber" defaultValue={t.taxNumber ?? ""} className={inputCls} /></Field>
          <Field label="USt-IdNr."><input name="vatId" defaultValue={t.vatId ?? ""} className={inputCls} /></Field>
        </div>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label="IBAN"><input name="iban" defaultValue={t.iban ?? ""} className={inputCls} /></Field>
          <Field label="BIC"><input name="bic" defaultValue={t.bic ?? ""} className={inputCls} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="smallBusiness" defaultChecked={t.smallBusiness} className="h-4 w-4 accent-[var(--color-ledger)]" />
          Kleinunternehmer (§ 19 UStG, keine Umsatzsteuer)
        </label>
        <ErrorNote error={error} />
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} className={cx(btn.base, btn.primary, "flex-1")}>Speichern</button>
          <button type="button" onClick={onClose} className={cx(btn.base, btn.secondary, "flex-1")}>Abbrechen</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ t, onClose }: { t: TenantRow; onClose: () => void }) {
  const { call, busy, error } = useApi();
  const [typed, setTyped] = useState("");
  const v = typed.trim();
  const ok = v.toLowerCase() === t.slug.toLowerCase() || v.toLocaleUpperCase("de-DE") === "LÖSCHEN";
  return (
    <Modal title="Firma löschen" onClose={onClose}>
      <p className="mt-2 text-sm">
        Sind Sie sicher, dass Sie die Firma <strong>„{t.name}“</strong> löschen möchten? Alle zugehörigen Filialen, Buchungen,
        Belege und Benutzer werden <strong className="text-minus">unwiderruflich</strong> gelöscht.
      </p>
      <form className="mt-4 space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        if (!ok) return;
        if (await call("DELETE", `/api/v1/super/tenants/${t.id}`, { confirm: v })) onClose();
      }}>
        <Field label={`Zur Bestätigung „${t.slug}“ oder „LÖSCHEN“ eintippen`}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus spellCheck={false}
            className={inputCls} placeholder={t.slug} />
        </Field>
        <ErrorNote error={error} />
        <div className="flex flex-wrap gap-2">
          <button disabled={busy || !ok} className={cx(btn.base, "flex-1 bg-minus text-white hover:opacity-90")}>Endgültig löschen</button>
          <button type="button" onClick={onClose} className={cx(btn.base, btn.secondary, "flex-1")}>Abbrechen</button>
        </div>
      </form>
    </Modal>
  );
}
