import type { AuthUser } from "@/infrastructure/auth/session";
import { forbidden } from "@/domain/errors";
import type { Role } from "@/infrastructure/db/schema";

export type Ctx = AuthUser;

export function requireRole(ctx: Ctx, ...roles: Role[]) {
  if (!roles.includes(ctx.role)) throw forbidden();
}

/** Mandanten-ID des angemeldeten Benutzers (wirft bei Super-Admin ohne Mandant) */
export function tid(ctx: Ctx): string {
  if (!ctx.tenantId) throw forbidden("Kein Mandant zugeordnet");
  return ctx.tenantId;
}
