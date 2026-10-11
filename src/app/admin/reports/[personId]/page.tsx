import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPersonReport } from "@/application/reports/person-report";
import { btn, cx, PageHeader } from "@/components/ui";
import { PersonReportView, pdfHref } from "@/components/person-report-view";
import { ReportRangeForm, resolveRange } from "@/components/report-range-form";

export const metadata: Metadata = { title: "Einzelbericht" };

export default async function PersonReportPage({ params, searchParams }: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ from?: string; to?: string; month?: string }>;
}) {
  const user = await requireUser("ADMIN");
  const { personId } = await params;
  const { from, to } = resolveRange(await searchParams);
  const r = await getPersonReport(user, personId, from, to);
  return (
    <>
      <PageHeader title={`Einzelbericht ${r.person.name}`}
        subtitle={<Link href={`/admin/reports?from=${from}&to=${to}`} className="text-ledger">← alle Einzelberichte</Link>}
        actions={<a href={pdfHref(r)} className={cx(btn.base, btn.primary)}>Monatsbericht PDF</a>} />
      <ReportRangeForm from={from} to={to} />
      <PersonReportView r={r} />
    </>
  );
}
