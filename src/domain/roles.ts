import type { Role } from "@/infrastructure/db/schema";

/** Rollen mit Admin-Rechten auf Mandanten-/Firmen-Ebene (Übergang Phase 1–4) */
export const ADMIN_LIKE: Role[] = ["ADMIN", "TENANT_OWNER", "COMPANY_ADMIN"];

export function isAdminLike(role: Role): boolean {
  return ADMIN_LIKE.includes(role);
}

/** Erweitert ["ADMIN"] um TENANT_OWNER / COMPANY_ADMIN für bestehende route()-Aufrufe */
export function expandRoles(roles: Role[]): Role[] {
  if (!roles.includes("ADMIN")) return roles;
  const set = new Set<Role>([...roles, ...ADMIN_LIKE]);
  return [...set];
}

export function homeForRole(role: Role): string {
  if (role === "SUPER_ADMIN") return "/super/tenants";
  if (isAdminLike(role)) return "/admin/dashboard";
  if (role === "PARTNER") return "/partner";
  return "/me";
}
