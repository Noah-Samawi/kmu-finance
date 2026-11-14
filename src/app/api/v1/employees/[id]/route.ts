import { z } from "zod";
import { body, route } from "@/lib/api";
import { employeeUpdateSchema } from "@/lib/validation/schemas";
import { deleteEmployee, getEmployee, updateEmployee } from "@/application/employees/employees";

type P = { id: string };

export const GET = route<P>(["ADMIN"], async ({ ctx, params }) => ({ employee: await getEmployee(ctx, params.id) }));

/** Name ändern, sperren/entsperren ({ isActive }), Passwort zurücksetzen, Login freischalten */
export const PATCH = route<P>(["ADMIN"], async ({ req, ctx, params }) => ({
  employee: await updateEmployee(ctx, params.id, await body(req, employeeUpdateSchema)),
}));

/** Löschen: { confirm: "<exakter Name>" } – mit Buchungen nur Deaktivierung */
export const DELETE = route<P>(["ADMIN"], async ({ req, ctx, params }) => {
  const { confirm } = await body(req, z.object({ confirm: z.string().trim().min(1).max(120) }));
  return deleteEmployee(ctx, params.id, confirm);
});
