import Link from "next/link";
import type { FullPersonReport } from "@/application/reports/person-report";
import type { AccountBlock } from "@/domain/person-report";
import { fmtDate } from "@/domain/period";
import { Empty, Money, Pill, Section, Table, td } from "./ui";
import { PartnerBookingList } from "./partner-booking-list";

const ROLE: Record<FullPersonReport["person"]["role"], string> = { EMPLOYEE: "Mitarbeiter", PARTNER: "Gesellschafter" };

export function pdfHref(r: { person: { id: string }; from: string; to: string }) {
  return `/api/v1/reports/person/${r.person.id}?from=${r.from}&to=${r.to}`;
}

function AccountCard({ a }: { a: AccountBlock }) {
  return (
    <Section title={a.title}>
      <p className="-mt-2 mb-3 text-xs text-muted">{a.hint}</p>
      <dl className="space-y-1.5 text-sm tabular">
        <Row label="Anfangsbestand (Übertrag)" cents={a.openingCents} />
        {a.lines.map((l) => <Row key={l.label} label={l.label} cents={l.label.startsWith("−") ? Math.abs(l.cents) : l.cents} muted={l.cents === 0} />)}
        <div className="flex justify-between gap-3 border-t border-line pt-1.5 font-semibold">
          <dt>{a.closingLabel}</dt><dd><Money cents={a.closingCents} /></dd>
        </div>
        {a.firmViewCents !== null && (
          <div className="flex justify-between gap-3 text-minus">
            <dt>Sicht der Firma: {a.firmViewLabel}</dt><dd><Money cents={a.firmViewCents} /></dd>
          </div>
        )}
      </dl>
    </Section>
  );
}

function Row({ label, cents, muted }: { label: string; cents: number; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${muted ? "text-muted" : ""}`}>
      <dt>{label}</dt><dd><Money cents={cents} /></dd>
    </div>
  );
}

/** Einzelbericht einer Person: Konten, Ergebnis, Transfers, alle Bewegungen */
export function PersonReportView({ r }: { r: FullPersonReport }) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-surface p-4 md:p-5">
        <p className="text-sm text-muted">{ROLE[r.person.role]} · {fmtDate(new Date(r.from + "T12:00:00Z"))} – {fmtDate(new Date(r.to + "T12:00:00Z"))}</p>
        <ul className="mt-2 space-y-1 text-sm">
          {r.statements.map((s) => <li key={s}>• {s}</li>)}
        </ul>
      </section>

      <div className={`grid gap-4 ${r.accounts.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
        {r.accounts.map((a) => <AccountCard key={a.key} a={a} />)}
      </div>

      <Section title={`Geldtransfers Kasse / Bankkonto (${r.transfers.length})`} flush>
        {!r.transfers.length ? <Empty title="Keine Transfers im Zeitraum" /> : (
          <Table head={["Datum", "Richtung", "Konto", "Betrag", "Vorgang", "Verwendungszweck"].map((h) => <span key={h} className={h === "Betrag" ? "block text-right" : ""}>{h}</span>)}>
            {r.transfers.map((t) => (
              <tr key={t.id} className={t.reversed ? "opacity-60" : ""}>
                <td className={td}>{fmtDate(t.date)}</td>
                <td className={td}>{t.directionLabel}</td>
                <td className={td}>{t.accountLabel}</td>
                <td className={td + " text-right"}><Money cents={t.amountCents} /></td>
                <td className={td}>{t.kind}{t.reversed && <> <Pill>storniert</Pill></>}</td>
                <td className={td} dir="auto">{t.purpose}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {r.person.role === "PARTNER" && (
        <Section title="Gesellschafter-Buchungen (Herkunft, Zweck, Erstattungsstatus)" flush>
          <PartnerBookingList rows={r.partnerBookings} />
        </Section>
      )}

      <Section title={`Alle Bewegungen (${r.movements.length})`} flush>
        {!r.movements.length ? <Empty title="Keine Bewegungen im Zeitraum" /> : (
          <Table head={["Datum", "Vorgang", "Konto", "Betrag", "Saldo danach", "Zweck / Herkunft"].map((h) => <span key={h} className={h === "Betrag" || h === "Saldo danach" ? "block text-right" : ""}>{h}</span>)}>
            {r.movements.map((m) => (
              <tr key={m.id} className={m.reversed ? "opacity-60" : ""}>
                <td className={td}>{fmtDate(m.date)}</td>
                <td className={td}>{m.kind}{m.reversed && <> <Pill>storniert</Pill></>}</td>
                <td className={td}>{m.accountLabel}</td>
                <td className={td + " text-right"}><Money cents={m.deltaCents} signed /></td>
                <td className={td + " text-right"}>{m.balanceAfterCents === null ? "–" : <Money cents={m.balanceAfterCents} />}</td>
                <td className={td} dir="auto">{[m.purpose, m.via && `über ${m.via}`].filter(Boolean).join(" · ")}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

/** Kompakte Karte je Person mit Link auf den eigenen Bericht */
export function PersonReportCard({ r, href }: { r: FullPersonReport; href: string }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{r.person.name}</p>
          <p className="text-xs text-muted">{ROLE[r.person.role]}</p>
        </div>
        <a href={pdfHref(r)} className="text-sm font-medium text-ledger">PDF</a>
      </div>
      <dl className="mt-3 space-y-1 text-sm tabular">
        {r.accounts.map((a) => (
          <div key={a.key} className="flex justify-between gap-3">
            <dt className="text-muted">{a.key === "OUTLAY" ? "Firma schuldet (Auslagen)" : a.key === "BUDGET" ? "Restguthaben (Budget)" : "Kapitalkonto"}</dt>
            <dd><Money cents={a.closingCents} className={a.key === "OUTLAY" && a.closingCents > 0 ? "text-minus" : ""} /></dd>
          </div>
        ))}
      </dl>
      <Link href={href} className="mt-3 inline-block text-sm font-medium text-ledger">Einzelbericht öffnen →</Link>
    </section>
  );
}
