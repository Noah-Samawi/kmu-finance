import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listContacts } from "@/application/contacts/contacts";
import { Empty, PageHeader, Pill, Section } from "@/components/ui";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = { title: "Kunden & Lieferanten" };

const TYPE = { CUSTOMER: "Kunde", SUPPLIER: "Lieferant", BOTH: "Kunde & Lieferant" } as const;

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string; archived?: string }> }) {
  const user = await requireUser("ADMIN");
  const sp = await searchParams;
  const contacts = await listContacts(user, { q: sp.q?.slice(0, 100), includeArchived: sp.archived === "1" });
  return (
    <>
      <PageHeader title="Kunden & Lieferanten" subtitle="Stammdaten und Rechnungsverlauf" />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Section flush actions={
          <form className="flex w-full items-center gap-3">
            <input name="q" defaultValue={sp.q} placeholder="Name suchen" className="h-9 w-full rounded-full border border-line px-3 text-sm focus:border-ledger focus:outline-none" />
            <label className="flex shrink-0 items-center gap-1.5 text-sm text-muted">
              <input type="checkbox" name="archived" value="1" defaultChecked={sp.archived === "1"} className="accent-[var(--color-ledger)]" /> Archiv
            </label>
          </form>
        }>
          {contacts.length === 0 ? <Empty title="Keine Kontakte gefunden">Lege rechts deinen ersten Kunden an.</Empty> : (
            <ul className="divide-y divide-line">
              {contacts.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/contacts/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-paper md:px-5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block truncate text-sm text-muted">{[c.city, c.email].filter(Boolean).join(" – ") || "Keine Adresse"}</span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      {c.archived && <Pill tone="amber">archiviert</Pill>}
                      <Pill>{TYPE[c.type]}</Pill>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Neuer Kontakt"><ContactForm /></Section>
      </div>
    </>
  );
}
