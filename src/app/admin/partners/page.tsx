import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listPartners } from "@/application/partners/partners";
import { Empty, Money, PageHeader, Pill, Section } from "@/components/ui";
import { PartnerForms } from "./partner-forms";

export const metadata: Metadata = { title: "Partner & Gesellschafter" };

export default async function PartnersPage() {
  const user = await requireUser("ADMIN");
  const partners = await listPartners(user);
  return (
    <>
      <PageHeader title="Partner & Gesellschafter" subtitle="Einlagen, Entnahmen, Gewinnanteile und Zugriffsrechte" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Section flush>
          {partners.length === 0 ? <Empty title="Noch keine Gesellschafter">Lege rechts den ersten Partner an.</Empty> : (
            <ul className="divide-y divide-line">
              {partners.map((p) => (
                <li key={p.id} className="px-4 py-4 md:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{p.name}{!p.isActive && <Pill tone="red">gesperrt</Pill>}</p>
                      <p className="text-sm text-muted">{p.email}</p>
                      <p className="text-xs text-muted">Berichte {p.canViewReports ? "ja" : "nein"} · Bank {p.canViewBank ? "ja" : "nein"}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted">Kapitalkonto</p>
                      <Money cents={p.capitalCents} className="font-semibold" />
                    </div>
                  </div>
                  <PartnerForms partner={p} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Neuer Gesellschafter"><PartnerForms /></Section>
      </div>
    </>
  );
}
