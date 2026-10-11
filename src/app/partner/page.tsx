import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getPartner } from "@/application/partners/partners";
import { Section } from "@/components/ui";
import { LedgerList } from "@/components/ledger-list";
import { PartnerBookingList } from "@/components/partner-booking-list";
import { formatCents } from "@/domain/money";
import { todayKey } from "@/domain/period";
import { getT } from "@/lib/i18n-server";
import { SelfBookingForm } from "./self-booking-form";

export const metadata: Metadata = { title: "Kapitalkonto" };

export default async function PartnerHome() {
  const user = await requireUser("PARTNER");
  const t = await getT();
  const p = await getPartner(user, user.userId);
  const cards = [
    { label: t("pb.capital"), hint: t("pb.capitalHint"), cents: p.capitalCents },
    { label: t("pb.outlay"), hint: t("pb.outlayHint"), cents: p.outlayOpenCents, accent: p.outlayOpenCents > 0, firm: -p.outlayOpenCents },
    { label: t("pb.budget"), hint: t("pb.budgetHint"), cents: p.budgetCents },
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <section key={c.label} className={`rounded-xl border bg-surface p-4 ${c.accent ? "border-amber-400" : "border-line"}`}>
            <p className="text-sm text-muted">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular">{formatCents(c.cents)}</p>
            {c.firm !== undefined && c.firm !== 0 && <p className="text-xs font-medium text-amber-700">{t("pb.firmLiability")}: {formatCents(c.firm)}</p>}
            <p className="mt-1 text-xs text-muted">{c.hint}</p>
          </section>
        ))}
      </div>
      <Section title={t("pb.new")}>
        <SelfBookingForm today={todayKey()} />
      </Section>
      <Section title={t("pb.list")} flush>
        <PartnerBookingList rows={p.bookings} />
      </Section>
      <Section title={t("pb.ledger")} flush>
        <LedgerList rows={p.entries} mode="both" />
      </Section>
    </div>
  );
}
