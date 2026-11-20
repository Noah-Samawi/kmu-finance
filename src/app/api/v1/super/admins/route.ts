import { body, route } from "@/lib/api";
import { createPlatformAdmin, createPlatformAdminSchema, listPlatformAdmins } from "@/application/platform-admins";

export const GET = route(["SUPER_ADMIN"], async ({ ctx }) => ({
  admins: await listPlatformAdmins(ctx),
}));

export const POST = route(["SUPER_ADMIN"], async ({ req, ctx }) =>
  createPlatformAdmin(ctx, await body(req, createPlatformAdminSchema)));
