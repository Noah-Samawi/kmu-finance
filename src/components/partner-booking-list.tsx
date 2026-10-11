"use client";

import type { PartnerBookingRow } from "@/application/partners/partner-bookings";
import { formatCents } from "@/domain/money";
import { fmtDate } from "@/domain/period";
import type { MsgKey } from "@/lib/i18n";
import { useT } from "./i18n";
import { Empty, Money, Pill } from "./ui";

export function PartnerStatus({ b }: { b: PartnerBookingRow }) {
  const t = useT();
  if (b.reversed) return <Pill>{t("pb.status.reversed")}</Pill>;
  if (b.status === "REFUNDED") return <Pill tone="green">{t("pb.status.REFUNDED")}</Pill>;
  if (b.status === "PARTIAL") return <Pill tone="amber">{t("pb.status.PARTIAL")} · {t("pb.openRest")} {formatCents(b.openCents)}</Pill>;
  if (b.status === "OPEN") return <Pill tone="red">{t("pb.status.OPEN")}</Pill>;
  if (b.kind === "OUTLAY") return <Pill>{t("pb.status.company")}</Pill>;
  return null;
}

/** Gesellschafter-Vorgänge: Person, Herkunft, Betrag, Zweck und Erstattungsstatus */
export function PartnerBookingList({ rows, showPartner }: { rows: PartnerBookingRow[]; showPartner?: boolean }) {
  const t = useT();
  if (!rows.length) return <Empty title={t("pb.empty")} />;
  return (
    <ul className="divide-y divide-line">
      {rows.map((b) => {
        const outflow = b.kind === "DRAW" || b.kind === "OUTLAY_REFUND" || b.kind === "BUDGET"
          || (b.kind === "OUTLAY" && b.source !== "PRIVATE");
        return (
          <li key={b.id} className={`flex items-start gap-3 px-4 py-3 md:px-5 ${b.reversed ? "opacity-60" : ""}`}>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                {showPartner && <span>{b.partnerName} ·</span>}
                {t(`pb.kind.${b.kind}` as MsgKey)}
                <PartnerStatus b={b} />
              </p>
              <p className="text-sm text-muted" dir="auto">{b.purpose}</p>
              <p className="flex flex-wrap gap-x-2 text-xs text-muted">
                <span>{fmtDate(b.bookingDate)}</span>
                {b.source && <span>· {t(`pb.source.${b.source}` as MsgKey)}</span>}
                {b.hasReceipt
                  ? <a className="text-ledger underline-offset-2 hover:underline" href={`/api/v1/partner-bookings/${b.id}/receipt`} target="_blank" rel="noreferrer">· {t("pb.receiptLink")}</a>
                  : <span>· {t("pb.noReceipt")}</span>}
                {!b.selfEntered && <span>· {t("pb.enteredBy")} {b.createdByName}</span>}
              </p>
              {b.settles.length > 0 && (
                <p className="text-xs text-muted">
                  {t("pb.settles")}: {b.settles.map((s) => `${fmtDate(s.bookingDate)} ${s.purpose} (${formatCents(s.amountCents)})`).join("; ")}
                </p>
              )}
            </div>
            <Money cents={outflow ? -b.amountCents : b.amountCents} signed className="shrink-0 font-semibold" />
          </li>
        );
      })}
    </ul>
  );
}
