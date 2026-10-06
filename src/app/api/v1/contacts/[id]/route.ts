import { body, route } from "@/lib/api";
import { contactUpdateSchema } from "@/lib/validation/schemas";
import { getContact, updateContact } from "@/application/contacts/contacts";

type P = { id: string };

/** Kontakt inkl. Rechnungshistorie und Status-Statistik */
export const GET = route<P>(["ADMIN"], async ({ ctx, params }) => getContact(ctx, params.id));

export const PATCH = route<P>(["ADMIN"], async ({ req, ctx, params }) => ({
  contact: await updateContact(ctx, params.id, await body(req, contactUpdateSchema)),
}));
