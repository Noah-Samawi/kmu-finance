import { body, query, route } from "@/lib/api";
import { contactSchema } from "@/lib/validation/schemas";
import { createContact, listContacts } from "@/application/contacts/contacts";

/** ?q=Suchbegriff&archived=1 */
export const GET = route(["ADMIN"], async ({ req, ctx }) => {
  const q = query(req);
  return { contacts: await listContacts(ctx, { q: q.q, includeArchived: q.archived === "1" }) };
});

export const POST = route(["ADMIN"], async ({ req, ctx }) => ({
  contact: await createContact(ctx, await body(req, contactSchema)),
}));
