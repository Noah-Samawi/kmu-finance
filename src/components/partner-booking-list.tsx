"use client";

import { useMemo, useState } from "react";
import type { PartnerBookingRow } from "@/application/partners/partner-bookings";
import type { LedgerRow } from "@/application/reports/reports";
import { formatCents } from "@/domain/money";
import { fmtDate } from "@/domain/period";
import {
  PARTNER_ART_LABEL, PARTNER_ARTS, artFromLedger, artFromPartnerKind, type PartnerArt,
} from "@/domain/partner-overview";
import type { MsgKey } from "@/lib/i18n";
import { useT } from "./i18n";
import { Empty, Money, Pill, cx } from "./ui";
import { EntryActions } from "./entry-actions";
import type { BranchOption } from "./branch-category";

export function PartnerStatus({ b }: { b: PartnerBookingRow }) {
  const t = useT();
  if (b.reversed) return <Pill>{t("pb.status.reversed")}</Pill>;
  if (b.status === "REFUNDED") return <Pill tone="green">{t("pb.status.REFUNDED")}</Pill>;
  if (b.status === "PARTIAL") return <Pill tone="amber">{t("pb.status.PARTIAL")} · {t("pb.openRest")} {formatCents(b.openCents)}</Pill>;
  if (b.status === "OPEN") return <Pill tone="red">{t("pb.status.OPEN")}</Pill>;
  if (b.kind === "OUTLAY") return <Pill>{t("pb.status.company")}</Pill>;
  if (b.kind === "PURCHASE_CAPITAL" || b.kind === "PURCHASE_BUDGET") return <Pill tone="green">{t("pb.status.purchase")}</Pill>;
  return null;
}

type Activity = {
  key: string;
  art: PartnerArt;
  title: string;
  purpose: string;
  date: Date;
  amountCents: number; // signed for display
  ledgerEntryId: string;
  branchId: string | null;
  branchName: string | null;
  booking?: PartnerBookingRow;
  canEdit: boolean;
};

function activitiesFrom(
  rows: PartnerBookingRow[],
  ledgerEntries: LedgerRow[] | undefined,
  t: (k: MsgKey) => string,
): Activity[] {
  const bookingLedgerIds = new Set(rows.map((b) => b.ledgerEntryId));
  const fromBookings: Activity[] = rows.map((b) => {
    // Partner-Sicht: Einlage −; Rückzahlung/Gewinn/Budget +; Firmenausgaben −
    let signed = b.amountCents;
    if (b.kind === "DEPOSIT") signed = -b.amountCents;
    else if (b.kind === "DRAW" || b.kind === "PROFIT" || b.kind === "BUDGET") signed = b.amountCents;
    else if (b.kind === "OUTLAY" && b.source === "PRIVATE") signed = b.amountCents;
    else if (
      b.kind === "OUTLAY_REFUND" || b.kind === "PURCHASE_CAPITAL" || b.kind === "PURCHASE_BUDGET"
      || b.kind === "BUDGET_RETURN" || b.kind === "BUDGET_SETTLED"
      || (b.kind === "OUTLAY" && b.source !== "PRIVATE")
    ) signed = -b.amountCents;
    return {
      key: `b-${b.id}`,
      art: artFromPartnerKind(b.kind, b.source),
      title: t(`pb.kind.${b.kind}` as MsgKey),
      purpose: b.purpose,
      date: b.bookingDate,
      amountCents: signed,
      ledgerEntryId: b.ledgerEntryId,
      branchId: b.branchId,
      branchName: b.branchName,
      booking: b,
      canEdit: !b.reversed && b.refundedCents === 0 && b.kind !== "OUTLAY_REFUND",
    };
  });

  const fromLedger: Activity[] = (ledgerEntries ?? [])
    .filter((e) => !bookingLedgerIds.has(e.id) && e.type !== "REVERSAL")
    .map((e) => {
      const tEff = e.type;
      const art = artFromLedger(tEff, e.partnerRole);
      if (art === "SONST" && !e.partnerRole && e.partnerDeltaCents === 0 && e.claimDeltaCents === 0 && e.walletDeltaCents === 0) {
        // reine Firmenausgabe ohne Rolle trotzdem zeigen wenn Personen-Zuordnung
        if (tEff !== "EXPENSE" && tEff !== "PARTNER_EXPENSE") return null;
      }
      const paid = e.cashDeltaCents + e.bankDeltaCents;
      const resolvedArt = art === "SONST" && (tEff === "EXPENSE" || tEff === "PARTNER_EXPENSE") ? "FIRMA" as const : art;
      // Partner-Sicht: Zuflüsse an ihn +, Einlage/Firmenausgabe −
      let signed = paid !== 0 ? paid : e.partnerDeltaCents || e.walletDeltaCents || e.claimDeltaCents;
      if (resolvedArt === "GEWINN" || resolvedArt === "LOHN" || resolvedArt === "RUECKZAHLUNG" || resolvedArt === "BUDGET") {
        signed = Math.abs(paid || e.walletDeltaCents || e.partnerDeltaCents);
      } else if (resolvedArt === "KAPITAL") {
        signed = e.partnerDeltaCents !== 0 ? e.partnerDeltaCents : -Math.abs(paid);
      } else if (resolvedArt === "FIRMA") {
        signed = paid !== 0 ? (paid < 0 ? paid : -paid) : -Math.abs(e.partnerDeltaCents);
      }
      return {
        key: `l-${e.id}`,
        art: resolvedArt,
        title: e.partnerRole === "LOHN" ? "Lohn"
          : e.partnerRole === "GEWINN" ? "Gewinnanteil-Auszahlung"
            : e.partnerRole === "PRIVAT" ? "Kapitalrückzahlung"
              : e.partnerRole === "FIRMA" ? "Betriebsausgabe"
                : (e.description?.split(" · ")[0] || tEff),
        purpose: e.description ?? "",
        date: e.bookingDate,
        amountCents: signed,
        ledgerEntryId: e.id,
        branchId: e.branchId,
        branchName: e.branchName,
        canEdit: true,
      };
    })
    .filter((x): x is Activity => !!x);

  return [...fromBookings, ...fromLedger].sort((a, b) => b.date.getTime() - a.date.getTime());
}

/** Gesellschafter-Vorgänge + Kasse-Zuordnungen: Filter/Gruppierung nach Art */
export function PartnerBookingList({ rows, ledgerEntries, showPartner, admin, branches }: {
  rows: PartnerBookingRow[];
  ledgerEntries?: LedgerRow[];
  showPartner?: boolean;
  admin?: boolean;
  branches?: BranchOption[];
}) {
  const t = useT();
  const [filter, setFilter] = useState<PartnerArt | "ALL">("ALL");
  const all = useMemo(() => activitiesFrom(rows, ledgerEntries, t), [rows, ledgerEntries, t]);
  const filtered = filter === "ALL" ? all : all.filter((a) => a.art === filter);
  const grouped = useMemo(() => {
    const map = new Map<PartnerArt, Activity[]>();
    for (const a of filtered) {
      const list = map.get(a.art) ?? [];
      list.push(a);
      map.set(a.art, list);
    }
    return PARTNER_ARTS.map((art) => ({ art, items: map.get(art) ?? [] })).filter((g) => g.items.length);
  }, [filtered]);

  if (!all.length) return <Empty title={t("pb.empty")} />;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 px-4 pb-2 md:px-5">
        <button type="button" onClick={() => setFilter("ALL")}
          className={cx("rounded-md border px-2 py-1 text-xs font-medium",
            filter === "ALL" ? "border-ledger bg-ledger-soft text-ink" : "border-line text-muted hover:text-ink")}>
          Alle ({all.length})
        </button>
        {PARTNER_ARTS.map((art) => {
          const n = all.filter((a) => a.art === art).length;
          if (!n) return null;
          return (
            <button key={art} type="button" onClick={() => setFilter(art)}
              className={cx("rounded-md border px-2 py-1 text-xs font-medium",
                filter === art ? "border-ledger bg-ledger-soft text-ink" : "border-line text-muted hover:text-ink")}>
              {PARTNER_ART_LABEL[art]} ({n})
            </button>
          );
        })}
      </div>
      {grouped.map(({ art, items }) => (
        <div key={art}>
          <p className="border-t border-line bg-paper px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted md:px-5">
            {PARTNER_ART_LABEL[art]}
          </p>
          <ul className="divide-y divide-line">
            {items.map((a) => (
              <li key={a.key} className={`flex items-start gap-3 px-4 py-3 md:px-5 ${a.booking?.reversed ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                    {showPartner && a.booking && <span>{a.booking.partnerName} ·</span>}
                    {a.title}
                    {a.booking && <PartnerStatus b={a.booking} />}
                    {a.branchName && <Pill tone="green">{a.branchName}</Pill>}
                    {a.booking?.editedFromCents != null && <Pill>{`geändert (vorher ${formatCents(a.booking.editedFromCents)})`}</Pill>}
                  </p>
                  <p className="text-sm text-muted" dir="auto">{a.purpose}</p>
                  <p className="flex flex-wrap gap-x-2 text-xs text-muted">
                    <span>{fmtDate(a.date)}</span>
                    {a.booking?.source && <span>· {t(`pb.source.${a.booking.source}` as MsgKey)}</span>}
                    {a.booking && (a.booking.hasReceipt
                      ? <a className="text-ledger underline-offset-2 hover:underline" href={`/api/v1/partner-bookings/${a.booking.id}/receipt`} target="_blank" rel="noreferrer">· {t("pb.receiptLink")}</a>
                      : <span>· {t("pb.noReceipt")}</span>)}
                    {a.booking && !a.booking.selfEntered && <span>· {t("pb.enteredBy")} {a.booking.createdByName}</span>}
                    {!a.booking && <span>· aus Kasse &amp; Bank</span>}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Money cents={a.amountCents} signed className="font-semibold" />
                  {admin && a.canEdit && (
                    <EntryActions id={a.ledgerEntryId} amountCents={Math.abs(a.amountCents)} description={a.purpose}
                      branchId={a.branchId} branches={branches} canEdit />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
