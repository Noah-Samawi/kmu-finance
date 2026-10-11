import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listPartners } from "@/application/partners/partners";
import { Empty, Money, PageHeader, Pill, Section } from "@/components/ui";
import { PartnerBookingList } from "@/components/partner-booking-list";
import { PartnerForms } from "./partner-forms";

export const metadata: Metadata = { title: "Partner & Gesellschafter" };

export default async function PartnersPage() {
  const user = await requireUser("ADMIN");
  const partners = await listPartners(user);
  return (
    <>
      <PageHeader title="Partner & Gesellschafter"
        subtitle="Kapitalkonto, Vorgelegtes Geld (Auslagen) und Budget – strikt getrennt, Erstattung nur gezielt" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {partners.length === 0 ? <Section><Empty title="Noch keine Gesellschafter">Lege rechts den ersten Partner an.</Empty></Section> : (
            partners.map((p) => (
              <Section key={p.id} flush>
                <div className="px-4 py-4 md:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{p.name}{!p.isActive && <Pill tone="red">gesperrt</Pill>}</p>
                      <p className="text-sm text-muted">{p.email}</p>
                      <p className="text-xs text-muted">Berichte {p.canViewReports ? "ja" : "nein"} · Bank {p.canViewBank ? "ja" : "nein"}</p>
                      <Link href={`/admin/reports/${p.id}`} className="text-sm font-medium text-ledger">Einzelbericht / Monatsbericht →</Link>
                    </div>
                    <dl className="grid grid-cols-3 gap-4 text-right">
                      <div><dt className="text-xs text-muted">Kapitalkonto</dt><dd><Money cents={p.capitalCents} className="font-semibold" /></dd></div>
                      <div>
                        <dt className="text-xs text-muted">Auslagenkonto – Firma schuldet</dt>
                        <dd><Money cents={p.outlayOpenCents} className={p.outlayOpenCents > 0 ? "font-semibold text-amber-700" : "font-semibold"} /></dd>
                        {p.outlayOpenCents > 0 && <dd className="text-xs text-amber-700">Verbindlichkeit der Firma <Money cents={-p.outlayOpenCents} /></dd>}
                      </div>
                      <div><dt className="text-xs text-muted">Budget / Vorschuss</dt><dd><Money cents={p.budgetCents} className="font-semibold" /></dd></div>
                    </dl>
                  </div>
                  <PartnerForms partner={p} />
                </div>
                <div className="border-t border-line">
                  <p className="px-4 pt-3 text-sm font-medium md:px-5">Buchungen (Herkunft, Zweck, Status)</p>
                  <PartnerBookingList rows={p.bookings.slice(0, 30)} />
                </div>
              </Section>
            ))
          )}
        </div>
        <Section title="Neuer Gesellschafter"><PartnerForms /></Section>
      </div>
    </>
  );
}
