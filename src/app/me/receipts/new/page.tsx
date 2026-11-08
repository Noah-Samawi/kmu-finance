import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { employeeOverview } from "@/application/dashboard";
import { listBranches } from "@/application/branches/branches";
import { todayKey } from "@/domain/period";
import { ReceiptUpload } from "./receipt-upload";

export const metadata: Metadata = { title: "Beleg einreichen" };

export default async function NewReceiptPage() {
  const user = await requireUser("EMPLOYEE");
  const [{ balanceCents }, branches] = await Promise.all([employeeOverview(user), listBranches(user, { activeOnly: true })]);
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Beleg einreichen</h1>
      <p className="mb-5 text-sm text-muted">Foto vom Kassenbon machen – Lieferant, Betrag und Datum werden erkannt. Bitte prüfen und absenden.</p>
      <ReceiptUpload balanceCents={balanceCents} today={todayKey()} branches={branches} />
    </>
  );
}
