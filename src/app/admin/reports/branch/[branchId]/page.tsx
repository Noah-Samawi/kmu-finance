import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getBranchReport } from "@/application/reports/branch-report";
import { btn, cx, PageHeader } from "@/components/ui";
import { BranchReportView, branchPdfHref } from "@/components/branch-report-view";
import { ReportRangeForm, resolveRange } from "@/components/report-range-form";

export const metadata: Metadata = { title: "Filialbericht" };

export default async function BranchReportPage({ params, searchParams }: {
  params: Promise<{ branchId: string }>;
  searchParams: Promise<{ from?: string; to?: string; month?: string }>;
}) {
  const user = await requireUser("ADMIN");
  const { branchId } = await params;
  const { from, to } = resolveRange(await searchParams);
  const r = await getBranchReport(user, branchId, from, to);
  return (
    <>
      <PageHeader title={`Einzelbericht ${r.branch.name}`}
        subtitle={<Link href={`/admin/reports?from=${from}&to=${to}`} className="text-ledger">← alle Einzelberichte</Link>}
        actions={<a href={branchPdfHref(r)} className={cx(btn.base, btn.primary)}>Monatsbericht PDF</a>} />
      <ReportRangeForm from={from} to={to} />
      <BranchReportView r={r} />
    </>
  );
}
