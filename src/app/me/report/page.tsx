import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getPersonReport } from "@/application/reports/person-report";
import { btn, cx, PageHeader } from "@/components/ui";
import { PersonReportView, pdfHref } from "@/components/person-report-view";
import { ReportRangeForm, resolveRange } from "@/components/report-range-form";

export const metadata: Metadata = { title: "Mein Bericht" };

export default async function MyReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; month?: string }> }) {
  const user = await requireUser("EMPLOYEE");
  const { from, to } = resolveRange(await searchParams);
  const r = await getPersonReport(user, user.userId, from, to);
  return (
    <>
      <PageHeader title="Mein Monatsbericht" actions={<a href={pdfHref(r)} className={cx(btn.base, btn.secondary, btn.sm)}>PDF</a>} />
      <ReportRangeForm from={from} to={to} />
      <PersonReportView r={r} />
    </>
  );
}
