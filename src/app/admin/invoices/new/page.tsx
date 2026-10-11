import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listContacts } from "@/application/contacts/contacts";
import { getOwnTenant } from "@/application/tenants/tenants";
import { PageHeader, Section, Empty } from "@/components/ui";
import { InvoiceEditor } from "../invoice-editor";
import { getT } from "@/lib/i18n-server";

export const metadata: Metadata = { title: "Neue Rechnung" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ contactId?: string }> }) {
  const user = await requireUser("ADMIN");
  const [contacts, tenant, sp, t] = await Promise.all([listContacts(user), getOwnTenant(user), searchParams, getT()]);
  return (
    <>
      <PageHeader title={t("inv.new")} subtitle={t("inv.newSubtitle")} />
      {contacts.length === 0 ? (
        <Section>
          <Empty title="Zuerst einen Kunden anlegen">
            <Link href="/admin/contacts" className="text-ledger hover:underline">Kunden anlegen</Link>
          </Empty>
        </Section>
      ) : (
        <InvoiceEditor
          contacts={contacts.map((c) => ({ id: c.id, name: c.name }))}
          smallBusiness={tenant.smallBusiness}
          initial={{
            contactId: sp.contactId ?? "", serviceDate: "", dueDate: "", notes: "", items: [],
            paymentMethod: tenant.defaultPaymentMethod,
          }}
        />
      )}
    </>
  );
}
