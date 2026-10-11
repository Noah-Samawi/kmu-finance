import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { getLetterhead } from "@/application/settings/settings";
import { PageHeader, Section } from "@/components/ui";
import { LetterheadForm } from "./letterhead-form";

export const metadata: Metadata = { title: "Briefkopf & Firma" };

export default async function SettingsPage() {
  const user = await requireUser("ADMIN");
  const t = await getLetterhead(user);
  return (
    <>
      <PageHeader title="Briefkopf & Rechnungsdesign" subtitle="Logo, Adresse, Bankverbindung und Standard-Zahlungsart" />
      <Section>
        <LetterheadForm tenant={t} />
      </Section>
    </>
  );
}
