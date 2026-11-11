import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listTenants } from "@/application/tenants/tenants";
import { Empty, PageHeader, Pill, Section, Table, td } from "@/components/ui";
import { fmtDate } from "@/domain/period";
import { CreateTenantForm, TenantActions } from "./tenant-forms";

export const metadata: Metadata = { title: "Mandanten" };

export default async function TenantsPage() {
  const user = await requireUser("SUPER_ADMIN");
  const tenants = await listTenants(user);
  return (
    <>
      <PageHeader title="Mandanten" subtitle={`${tenants.length} Firmen-Accounts`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Section title="Firmen" flush>
          {tenants.length === 0 ? (
            <Empty title="Noch keine Firmen angelegt">Lege rechts den ersten Mandanten mit seinem Geschäftsführer an.</Empty>
          ) : (
            <Table head={["Firma", "Admin", "Benutzer", "Seit", "Status", ""]} hideBelowMd={[1, 2, 3]}>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td className={td}><p className="font-medium">{t.name}</p><p className="text-xs text-muted">{t.slug} – {t.city}</p>
                    <p className="mt-0.5 break-all text-xs text-muted md:hidden">{t.adminEmail ?? "kein Admin"} · {t.userCount} Benutzer</p></td>
                  <td className={td + " hidden break-all text-muted md:table-cell"}>{t.adminEmail ?? "–"}</td>
                  <td className={td + " tabular hidden md:table-cell"}>{t.userCount}</td>
                  <td className={td + " hidden text-muted md:table-cell"}>{fmtDate(t.createdAt)}</td>
                  <td className={td}>{t.status === "ACTIVE" ? <Pill tone="green">Aktiv</Pill> : <Pill tone="red">Gesperrt</Pill>}</td>
                  <td className={td + " text-right"}><TenantActions t={t} /></td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
        <Section title="Neuen Mandanten anlegen">
          <CreateTenantForm />
        </Section>
      </div>
    </>
  );
}
