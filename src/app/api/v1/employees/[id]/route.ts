import { body, route } from "@/lib/api";
import { employeeUpdateSchema } from "@/lib/validation/schemas";
import { getEmployee, updateEmployee } from "@/application/employees/employees";

type P = { id: string };

export const GET = route<P>(["ADMIN"], async ({ ctx, params }) => ({ employee: await getEmployee(ctx, params.id) }));

/** Name ändern, sperren/entsperren ({ isActive }), Passwort zurücksetzen */
export const PATCH = route<P>(["ADMIN"], async ({ req, ctx, params }) => ({
  employee: await updateEmployee(ctx, params.id, await body(req, employeeUpdateSchema)),
}));
