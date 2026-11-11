// Einzelberichte je Filiale (Web + PDF) – gleiche Struktur wie Personen-Einzelberichte.
import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/infrastructure/db/client";
import { withTenant } from "@/infrastructure/db/tenant-tx";
import { branches, tenants } from "@/infrastructure/db/schema";
import {
  UNASSIGNED_BRANCH, UNASSIGNED_BRANCH_NAME, branchHeadline, branchReportTitle, buildBranchReport,
  reportFileStem, type BranchReport,
} from "@/domain/branch";
import { forbidden, notFound } from "@/domain/errors";
import { requireRole, tid, type Ctx } from "../context";
import { accountOpeningsByBranch, bankBalance, cashBalance } from "../ledger-service";
import { renderReportPdf } from "./export";
import { ledgerRows, rangeFromDays, type LedgerRow, type Summary } from "./reports";

export type FullBranchReport = BranchReport & { entries: LedgerRow[] };

function assertReportAccess(ctx: Ctx) {
  requireRole(ctx, "ADMIN", "PARTNER");
  if (ctx.role === "PARTNER" && !ctx.canViewReports) throw forbidden("Kein Zugriff auf Berichte");
}

function extras(rows: LedgerRow[]) {
  let receiptsCents = 0, adjustmentsCents = 0;
  for (const r of rows) {
    const t = r.type === "REVERSAL" ? r.reversedType ?? r.type : r.type;
    if (t === "RECEIPT") receiptsCents -= r.walletDeltaCents;
    if (t === "ADJUSTMENT") adjustmentsCents -= r.walletDeltaCents;
  }
  return { receiptsCents: receiptsCents + 0, adjustmentsCents: adjustmentsCents + 0 };
}

/** Summary nur für den PDF-Generator – Kasse/Bank/GuV dieser Filiale, ohne Personenberichte. */
export function summaryFromBranchReport(r: FullBranchReport): Summary {
  const extra = extras(r.entries);
  return {
    from: r.from, to: r.to,
    pool: {
      openingCents: 0, incomeInvoiceCents: 0, incomeManualCents: 0, allocatedCents: 0,
      returnedCents: 0, expenseCents: 0, otherCents: 0, closingCents: 0,
    },
    cash: r.cash, bank: r.bank,
    carryForward: { cashCents: r.cash.openingCents, bankCents: r.bank.openingCents, poolCents: 0 },
    totals: {
      ...extra, walletsOpenCents: 0, claimsOpenCents: 0,
      expensesCents: r.figures.costsCents, expensesByCategory: r.figures.costsByCategory,
    },
    employees: [], partners: [],
    entryCount: r.entries.length,
    scope: { branchId: r.branch.unassigned ? UNASSIGNED_BRANCH : r.branch.id, branchName: r.branch.name },
    pnl: { revenueCents: r.figures.revenueCents, costsCents: r.figures.costsCents, resultCents: r.figures.resultCents },
  };
}

async function resolveBranch(tx: Tx, tenantId: string, branchId: string) {
  if (branchId === UNASSIGNED_BRANCH) {
    return { id: UNASSIGNED_BRANCH, name: UNASSIGNED_BRANCH_NAME, unassigned: true as const };
  }
  const b = await tx.query.branches.findFirst({
    where: and(eq(branches.id, branchId), eq(branches.tenantId, tenantId)),
    columns: { id: true, name: true },
  });
  if (!b) throw notFound("Filiale");
  return { id: b.id, name: b.name, unassigned: false as const };
}

/** Admin: Übersicht – je Filiale ein eigener Bericht (keine Sammeltabelle) */
export async function listBranchReports(ctx: Ctx, from: string, to: string): Promise<FullBranchReport[]> {
  requireRole(ctx, "ADMIN");
  const tenantId = tid(ctx);
  const range = rangeFromDays(from, to);
  return withTenant(ctx, async (tx) => {
    const list = await tx.select({ id: branches.id, name: branches.name }).from(branches)
      .where(eq(branches.tenantId, tenantId)).orderBy(asc(branches.name));
    const rows = await ledgerRows(tx, tenantId, { range, limit: 100_000 });
    const openings = await accountOpeningsByBranch(tx, tenantId, range.start);
    const grouped = new Map<string, LedgerRow[]>();
    for (const r of rows) {
      const k = r.branchId ?? UNASSIGNED_BRANCH;
      const bucket = grouped.get(k);
      if (bucket) bucket.push(r);
      else grouped.set(k, [r]);
    }
    const zero = { cash: 0, bank: 0 };
    const one = (id: string, name: string, unassigned: boolean): FullBranchReport => {
      const slice = grouped.get(id) ?? [];
      const o = openings.get(id) ?? zero;
      return {
        ...buildBranchReport({
          branch: { id, name, unassigned }, from, to,
          opening: { cashCents: o.cash, bankCents: o.bank }, rows: slice,
        }),
        entries: slice,
      };
    };
    return [
      ...list.map((b) => one(b.id, b.name, false)),
      one(UNASSIGNED_BRANCH, UNASSIGNED_BRANCH_NAME, true),
    ];
  });
}

export async function getBranchReport(ctx: Ctx, branchId: string, from: string, to: string): Promise<FullBranchReport> {
  assertReportAccess(ctx);
  const tenantId = tid(ctx);
  const range = rangeFromDays(from, to);
  return withTenant(ctx, async (tx) => {
    const branch = await resolveBranch(tx, tenantId, branchId);
    const rows = await ledgerRows(tx, tenantId, { range, branchId, limit: 100_000 });
    const opening = {
      cashCents: await cashBalance(tx, tenantId, range.start, branchId),
      bankCents: await bankBalance(tx, tenantId, range.start, branchId),
    };
    return { ...buildBranchReport({ branch, from, to, opening, rows }), entries: rows };
  });
}

export async function exportBranchReport(
  ctx: Ctx, branchId: string, from: string, to: string, opts: { filePrefix?: string } = {},
) {
  const report = await getBranchReport(ctx, branchId, from, to);
  const tenantName = await withTenant(ctx, async (tx) =>
    (await tx.query.tenants.findFirst({ where: eq(tenants.id, tid(ctx)), columns: { name: true } }))!.name);
  const title = branchReportTitle({ branchName: report.branch.unassigned ? null : report.branch.name, unassigned: report.branch.unassigned });
  const headline = branchHeadline({ branchName: report.branch.unassigned ? null : report.branch.name, unassigned: report.branch.unassigned });
  const data = await renderReportPdf(tenantName, summaryFromBranchReport(report), report.entries, title, false, [], {
    branchHeadline: headline,
  });
  const prefix = opts.filePrefix ?? "Monatsbericht";
  const stem = report.branch.unassigned
    ? reportFileStem(from, to, "zentral", prefix)
    : reportFileStem(from, to, { branch: report.branch.name }, prefix);
  return { filename: `${stem}.pdf`, mime: "application/pdf" as const, data: Buffer.from(data) };
}
