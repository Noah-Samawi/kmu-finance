import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getSummary } from "@/application/reports/reports";
import { PageHeader, Section } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { PartnerBookingList } from "@/components/partner-booking-list";
import { formatCents } from "@/domain/money";
import { monthKey, todayKey } from "@/domain/period";

export const metadata: Metadata = { title: "Berichte" };

export default async function PartnerReports() {
  const user = await requireUser("PARTNER");
  if (!user.canViewReports) redirect("/partner");
  const from = `${monthKey()}-01`;
  const to = todayKey();
  const { summary, entries, partnerBookings } = await getSummary(user, from, to);
  return (
    <>
      <PageHeader title="Monatsbericht" subtitle={`${from} – ${to}`}
        actions={<a className="text-sm font-medium text-ledger" href={`/api/v1/reports/export?format=pdf&from=${from}&to=${to}`}>PDF</a>} />
      <Section title="Kapitalkonto">
        <p className="tabular">{summary.partners.find((p) => p.partnerId === user.userId)
          ? `Dein Kapitalkonto Ende: ${formatCents(summary.partners.find((p) => p.partnerId === user.userId)!.closingCents)}`
          : "Keine Kapitalbewegungen in diesem Monat"}</p>
      </Section>
      <Section title="Gesellschafter-Buchungen (Herkunft, Zweck, Erstattungsstatus)" flush>
        <PartnerBookingList rows={partnerBookings} showPartner />
      </Section>
      <Section title="Buchungen" flush>
        <LedgerList rows={entries} mode="both" />
      </Section>
    </>
  );
}
