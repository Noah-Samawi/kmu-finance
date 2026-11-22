import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listPartners } from "@/application/partners/partners";
import { poolOverview } from "@/application/pool/pool";
import { listBranches } from "@/application/branches/branches";
import { todayKey } from "@/domain/period";
import { Empty, Money, PageHeader, Pill, Section } from "@/components/ui";
import { PartnerBookingList } from "@/components/partner-booking-list";
import { PartnerForms } from "./partner-forms";

export const metadata: Metadata = { title: "Partner & Gesellschafter" };

export default async function PartnersPage() {
  const user = await requireUser("ADMIN");
  const [partners, pool, branches] = await Promise.all([listPartners(user), poolOverview(user), listBranches(user)]);
  const today = todayKey();
  return (
    <>
      <PageHeader title="Partner & Gesellschafter"
        subtitle="Kapital, Gewinnanteil, Betriebsausgaben, Lohn, Auslagen und Budget – getrennt. Buchungen aus Kasse & Bank erscheinen hier mit Filter." />
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
                    <dl className="grid grid-cols-2 gap-3 text-right sm:grid-cols-3 lg:grid-cols-4">
                      <div>
                        <dt className="text-xs text-muted">Kapitalkonto</dt>
                        <dd><Money cents={p.capitalCents} signed className="font-semibold" /></dd>
                        <dd className="text-[10px] text-muted">Einlage − · Rückzahlung +</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Kapitalrückzahlungen (an ihn)</dt>
                        <dd><Money cents={p.capitalReturnCents ?? 0} signed className="font-semibold" /></dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Gewinnanteil (gutgeschrieben)</dt>
                        <dd><Money cents={p.profitCents ?? 0} signed className="font-semibold" /></dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Betriebsausgaben (Firma)</dt>
                        <dd><Money cents={-(p.companyExpenseCents ?? 0)} signed className="font-semibold" /></dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Lohn (gutgeschrieben)</dt>
                        <dd><Money cents={p.wageCents ?? 0} signed className="font-semibold" /></dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Auslagenkonto – Firma schuldet</dt>
                        <dd><Money cents={p.outlayOpenCents} className={p.outlayOpenCents > 0 ? "font-semibold text-minus" : "font-semibold"} /></dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Budget / Vorschuss (Einkäufe)</dt>
                        <dd><Money cents={p.budgetCents} signed className="font-semibold" /></dd>
                      </div>
                    </dl>
                  </div>
                  <PartnerForms partner={p} today={today} cashCents={pool.cashBalanceCents} bankCents={pool.bankBalanceCents} branches={branches} />
                </div>
                <div className="border-t border-line">
                  <p className="px-4 pt-3 text-sm font-medium md:px-5">Buchungen (Filter / Gruppierung)</p>
                  <PartnerBookingList
                    rows={p.bookings.slice(0, 50)}
                    ledgerEntries={p.ledgerEntries}
                    admin
                    branches={branches}
                  />
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
