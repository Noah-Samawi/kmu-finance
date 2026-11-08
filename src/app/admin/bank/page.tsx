import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listBankStatements } from "@/application/bank/bank";
import { listBranches } from "@/application/branches/branches";
import { PageHeader, Section } from "@/components/ui";
import { formatCents } from "@/domain/money";
import { monthKey } from "@/domain/period";
import { BankUpload } from "./bank-upload";

export const metadata: Metadata = { title: "Kontoauszüge" };

export default async function BankPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await requireUser("ADMIN");
  const [statements, branches] = await Promise.all([listBankStatements(user), listBranches(user, { activeOnly: true })]);
  const sp = await searchParams;
  const { getBankStatement } = await import("@/application/bank/bank");
  const detail = sp.id ? await getBankStatement(user, sp.id) : null;

  return (
    <>
      <PageHeader title="Kontoauszüge & Abgleich" subtitle="CSV, OFX oder PDF hochladen. Grün = schon im Hauptbuch, Verbucht = neu als Einnahme/Ausgabe Bankkonto, Rot = offen, Blau = Geldtransit Bank → Kasse." />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Section title="Upload">
          <BankUpload defaultMonth={monthKey()} branches={branches} />
          <ul className="mt-4 divide-y divide-line text-sm">
            {statements.map((s) => (
              <li key={s.id} className="py-2">
                <Link className="text-ledger" href={`/admin/bank?id=${s.id}`}>{s.periodMonth} · {s.fileName}</Link>
              </li>
            ))}
          </ul>
        </Section>
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
      </div>
    </>
  );
}
