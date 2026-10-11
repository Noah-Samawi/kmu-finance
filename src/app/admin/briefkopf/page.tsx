import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getLetterhead } from "@/application/settings/settings";
import { PageHeader, Section } from "@/components/ui";
import { LetterheadForm } from "../settings/letterhead-form";

export const metadata: Metadata = { title: "Briefkopf & Firma" };

export default async function BriefkopfPage() {
  const user = await requireUser("ADMIN");
  const t = await getLetterhead(user);
  return (
    <>
      <PageHeader title="Briefkopf & Rechnungsdesign" subtitle="Logo oben rechts, Firmenadresse, Bankverbindung, Steuernummer und Fußtext erscheinen auf jeder Rechnung." />
      <Section>
        <LetterheadForm tenant={t} />
      </Section>
    </>
  );
}
