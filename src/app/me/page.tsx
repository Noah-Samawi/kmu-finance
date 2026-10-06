import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { employeeOverview } from "@/application/dashboard";
import { btn, cx, Section } from "@/components/ui";
import { Bon } from "@/components/bon";
import { LedgerList } from "@/components/ledger-list";
import { fmtDateTime } from "@/domain/period";

export const metadata: Metadata = { title: "Mein Konto" };

export default async function MePage() {
  const user = await requireUser("EMPLOYEE");
  const d = await employeeOverview(user);
  const t = d.today;

  return (
    <div className="space-y-5">
      <Bon
        tenant={user.tenantName ?? ""}
        stamp={fmtDateTime(new Date())}
        balanceCents={d.balanceCents}
        lines={[
          { label: "Heute erhalten", cents: t?.allocatedCents ?? 0 },
          { label: "Heute belegt", cents: t?.receiptsCents ?? 0 },
          { label: "Monat belegt", cents: d.month?.receiptsCents ?? 0 },
        ]}
      />

      <Link href="/me/receipts/new" className={cx(btn.base, btn.primary, "h-14 w-full text-base")}>
        Beleg fotografieren
      </Link>
      {d.balanceCents === 0 && (
        <p className="text-center text-sm text-muted">Kein Guthaben. Belege kannst du einreichen, sobald dir Budget zugeteilt wurde.</p>
      )}

      <Section title="Letzte Bewegungen" flush actions={<Link href="/me/history" className="text-sm font-medium text-ledger">Alle</Link>}>
        <LedgerList rows={d.recent} mode="wallet" />
      </Section>
    </div>
  );
}
