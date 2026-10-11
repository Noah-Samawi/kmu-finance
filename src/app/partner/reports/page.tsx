import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getPersonReport } from "@/application/reports/person-report";
import { btn, cx, PageHeader } from "@/components/ui";
import { PersonReportView, pdfHref } from "@/components/person-report-view";
import { ReportRangeForm, resolveRange } from "@/components/report-range-form";

export const metadata: Metadata = { title: "Mein Bericht" };

/** Eigener Einzelbericht – Firmenbericht nur mit Berichtsrecht */
export default async function PartnerReports({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; month?: string }> }) {
  const user = await requireUser("PARTNER");
  const { from, to } = resolveRange(await searchParams);
  const r = await getPersonReport(user, user.userId, from, to);
  return (
    <>
      <PageHeader title="Mein Monatsbericht"
        actions={<>
          <a href={pdfHref(r)} className={cx(btn.base, btn.primary, btn.sm)}>Mein Bericht PDF</a>
          {user.canViewReports && (
            <a href={`/api/v1/reports/export?format=pdf&from=${from}&to=${to}`} className={cx(btn.base, btn.secondary, btn.sm)}>Firmenbericht PDF</a>
          )}
        </>} />
      <ReportRangeForm from={from} to={to} />
      <PersonReportView r={r} />
    </>
  );
}
