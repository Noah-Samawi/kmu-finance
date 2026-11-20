import { z } from "zod";
import { body, route } from "@/lib/api";
import {
  changeEmailSchema, changeOwnEmail, changeOwnPassword, changePasswordSchema, getAccountProfile,
} from "@/application/auth-account";

export const GET = route(["ADMIN"], async ({ ctx }) => getAccountProfile(ctx));

const patchSchema = z.discriminatedUnion("action", [
  changeEmailSchema.extend({ action: z.literal("email") }),
  changePasswordSchema.extend({ action: z.literal("password") }),
]);

export const PATCH = route(["ADMIN"], async ({ req, ctx }) => {
  const input = await body(req, patchSchema);
  if (input.action === "email") return changeOwnEmail(ctx, input);
  return changeOwnPassword(ctx, input);
});
