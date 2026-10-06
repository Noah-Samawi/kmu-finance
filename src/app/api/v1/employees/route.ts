import { body, route } from "@/lib/api";
import { employeeCreateSchema } from "@/lib/validation/schemas";
import { createEmployee, listEmployees } from "@/application/employees/employees";

export const GET = route(["ADMIN"], async ({ ctx }) => ({ employees: await listEmployees(ctx) }));

export const POST = route(["ADMIN"], async ({ req, ctx }) => ({
  employee: await createEmployee(ctx, await body(req, employeeCreateSchema)),
}));
