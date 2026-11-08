import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listBankStatements } from "@/application/bank/bank";
import { listIncomingBills } from "@/application/incoming-bills";
import { listBranches } from "@/application/branches/branches";
import { PageHeader, Section } from "@/components/ui";
import { BillList } from "@/components/bill-list";
import { BillUpload } from "@/components/bill-upload";
import { formatCents } from "@/domain/money";
import { monthKey, todayKey } from "@/domain/period";
import { BankUpload } from "./bank-upload";

export const metadata: Metadata = { title: "Kontoauszüge" };

export default async function BankPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await requireUser("ADMIN");
  const [statements, branches, bills] = await Promise.all([
    listBankStatements(user), listBranches(user, { activeOnly: true }), listIncomingBills(user, { limit: 40 }),
  ]);
  const sp = await searchParams;
  const { getBankStatement } = await import("@/application/bank/bank");
  const detail = sp.id ? await getBankStatement(user, sp.id) : null;

  return (
    <>
      <PageHeader
        title="Kontoauszüge & Rechnungen"
        subtitle="Kontoauszug (CSV/OFX/PDF) links. Einzelne Lieferantenrechnung oder Quittung rechts – mit Pflicht-Auswahl Bar oder Bank, nie stillschweigend zugeordnet."
      />
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Section title="Kontoauszug (Bankumsätze)">
          <p className="mb-3 rounded-lg border border-amber/30 bg-amber-soft px-3 py-2 text-sm text-amber-900">
            Einzelne Rechnung oder Quittung? Nicht hier – bitte rechts unter „Rechnung / Quittung buchen“ hochladen und den Zahlungskanal wählen.
          </p>
          <BankUpload defaultMonth={monthKey()} branches={branches} />
          <ul className="mt-4 divide-y divide-line text-sm">
            {statements.map((s) => (
              <li key={s.id} className="py-2">
                <Link className="text-ledger" href={`/admin/bank?id=${s.id}`}>{s.periodMonth} · {s.fileName}</Link>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Rechnung / Quittung buchen">
          <BillUpload today={todayKey()} branches={branches} />
        </Section>
      </div>
      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Section title="Ampel">
          {!detail ? <p className="text-sm text-muted">Bitte einen Auszug wählen.</p> : (
            <ul className="divide-y divide-line text-sm">
              {detail.lines.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium">{l.payee || l.purpose || "Buchung"}</span>
                    <span className="block text-xs text-muted">{l.purpose}</span>
                  </span>
                  <span className="text-right">
                    <span className="block tabular">{formatCents(l.amountCents)}</span>
                    <span className={
                      l.status === "GREEN" || l.status === "BOOKED" ? "text-ledger"
                        : l.status === "CASH_WITHDRAWAL" ? "text-amber" : "text-minus"
                    }>
                      {l.status === "GREEN" ? "Grün" : l.status === "BOOKED" ? "Verbucht" : l.status === "CASH_WITHDRAWAL" ? "Kasse" : "Rot"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Gebuchte Eingangsrechnungen" actions={<Link href="/admin/invoices?tab=in" className="text-sm text-ledger hover:underline">Alle anzeigen</Link>} flush>
          <BillList bills={bills} branches={branches} />
        </Section>
      </div>
    </>
  );
}
