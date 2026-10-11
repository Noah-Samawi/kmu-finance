import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getPartner } from "@/application/partners/partners";
import { Section } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { formatCents } from "@/domain/money";

export const metadata: Metadata = { title: "Kapitalkonto" };

export default async function PartnerHome() {
  const user = await requireUser("PARTNER");
  const p = await getPartner(user, user.userId);
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-line bg-surface p-5">
        <p className="text-sm text-muted">Kapitalkonto (Einlagen − Entnahmen + Gewinnanteile)</p>
        <p className="mt-1 text-4xl font-semibold tabular">{formatCents(p.capitalCents)}</p>
      </section>
      <Section title="Bewegungen" flush>
        <LedgerList rows={p.entries} mode="both" />
      </Section>
    </div>
  );
}
