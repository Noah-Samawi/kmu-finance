import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { employeeOverview } from "@/application/dashboard";
import { todayKey } from "@/domain/period";
import { ReceiptUpload } from "./receipt-upload";

export const metadata: Metadata = { title: "Beleg einreichen" };

export default async function NewReceiptPage() {
  const user = await requireUser("EMPLOYEE");
  const { balanceCents } = await employeeOverview(user);
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Beleg einreichen</h1>
      <p className="mb-5 text-sm text-muted">Foto vom Kassenbon machen, Betrag und Händler eintragen – fertig.</p>
      <ReceiptUpload balanceCents={balanceCents} today={todayKey()} />
    </>
  );
}
