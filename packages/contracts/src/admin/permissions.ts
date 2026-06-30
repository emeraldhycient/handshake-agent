import { z } from "zod";

// The admin RBAC permission catalog — the SINGLE source of truth shared by the
// API (route guards + DB seeding) and the web-admin app (nav/page gating).
// Mirrors the Prisma `Permission` model: a permission guards an `api_route`, a
// `web_page`, or a `menu_item`, with one of four actions. A permission id is the
// colon-joined tuple; it is what appears in `AdminMe.permissions` and in role
// assignments. Default-deny: a route with no granted permission is forbidden.

export const AdminResourceTypeSchema = z.enum([
  "api_route",
  "web_page",
  "menu_item",
]);
export type AdminResourceType = z.infer<typeof AdminResourceTypeSchema>;

export const AdminPermissionActionSchema = z.enum([
  "read",
  "write",
  "delete",
  "execute",
]);
export type AdminPermissionAction = z.infer<typeof AdminPermissionActionSchema>;

// Catalog grouping — drives the admin UI's nav sections and the built-in-role
// grant matrix. Grows additively as later phases register their surfaces.
export const ADMIN_PERMISSION_CATEGORIES = [
  "Access",
  "Audit",
  "Config",
  "Pricing",
  "Catalog",
  "KYC",
  "Users",
  "Transactions",
  "Ledger",
  "Compliance",
  "Treasury",
  "Beneficiaries",
  "Comms",
  "Tickets",
  "Agent",
  "Metrics",
] as const;
export type AdminPermissionCategory = (typeof ADMIN_PERMISSION_CATEGORIES)[number];

export interface PermissionCatalogEntry {
  resourceType: AdminResourceType;
  /** "GET /admin/admins" | "/admin/audit" | "menu.access". */
  resourceId: string;
  action: AdminPermissionAction;
  category: AdminPermissionCategory;
  description: string;
}

export const AdminPermissionSchema = z.object({
  resourceType: AdminResourceTypeSchema,
  resourceId: z.string().min(1),
  action: AdminPermissionActionSchema,
});

/** Canonical id: `${resourceType}:${resourceId}:${action}`. */
export function permissionId(p: {
  resourceType: string;
  resourceId: string;
  action: string;
}): string {
  return `${p.resourceType}:${p.resourceId}:${p.action}`;
}

const r = (
  resourceType: AdminResourceType,
  resourceId: string,
  action: AdminPermissionAction,
  category: AdminPermissionCategory,
  description: string,
): PermissionCatalogEntry => ({
  resourceType,
  resourceId,
  action,
  category,
  description,
});

// ── Phase 0 catalog (Access + Audit + folded Treasury wallet ops) ──────────────
// Later phases append their own entries; ids must stay globally unique.
export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  // Access — admin users
  r("api_route", "GET /admin/admins", "read", "Access", "List admin users"),
  r("api_route", "GET /admin/admins/:id", "read", "Access", "View an admin user"),
  r("api_route", "PATCH /admin/admins/:id/role", "write", "Access", "Change an admin user's role"),
  r("api_route", "PATCH /admin/admins/:id/status", "write", "Access", "Suspend / reactivate / offboard an admin user"),
  r("api_route", "POST /admin/invitations", "write", "Access", "Invite a new admin user"),
  // Access — roles & permissions
  r("api_route", "GET /admin/roles", "read", "Access", "List roles"),
  r("api_route", "POST /admin/roles", "write", "Access", "Create a role"),
  r("api_route", "PATCH /admin/roles/:id", "write", "Access", "Edit a role's permissions"),
  r("api_route", "GET /admin/permissions", "read", "Access", "List the permission catalog"),
  // Access — sessions
  r("api_route", "GET /admin/sessions", "read", "Access", "List admin sessions"),
  r("api_route", "DELETE /admin/sessions/:id", "write", "Access", "Revoke an admin session"),
  // Audit
  r("api_route", "GET /admin/audit", "read", "Audit", "Read the audit log"),
  r("api_route", "POST /admin/audit/verify", "execute", "Audit", "Verify audit-chain integrity"),
  // Treasury (folded legacy wallet ops)
  r("api_route", "POST /admin/wallets/reconcile", "execute", "Treasury", "Reconcile a user's on-chain vs ledger balance"),
  r("api_route", "POST /admin/wallets/backfill-networks", "execute", "Treasury", "Enqueue a wallet-network backfill"),
  r("api_route", "GET /admin/wallets/backfill-runs/:id", "read", "Treasury", "Read a backfill run's status"),

  // Web pages (nav/page gating — UX only; the API still enforces api_route perms)
  r("web_page", "/admin/admins", "read", "Access", "Admin user management page"),
  r("web_page", "/admin/roles", "read", "Access", "Role & permission management page"),
  r("web_page", "/admin/sessions", "read", "Access", "Admin sessions page"),
  r("web_page", "/admin/audit", "read", "Audit", "Audit log viewer page"),
  r("web_page", "/admin/treasury", "read", "Treasury", "Treasury / wallet tools page"),
  // Menu items (nav groups)
  r("menu_item", "menu.access", "read", "Access", "Access & RBAC nav group"),
  r("menu_item", "menu.audit", "read", "Audit", "Audit nav group"),
  r("menu_item", "menu.treasury", "read", "Treasury", "Treasury nav group"),
];

// ── Built-in roles ─────────────────────────────────────────────────────────────
export const BUILTIN_ROLE_NAMES = [
  "super_admin",
  "ops",
  "compliance",
  "finance",
  "support",
] as const;
export type BuiltinRoleName = (typeof BUILTIN_ROLE_NAMES)[number];

export interface BuiltinRoleDef {
  name: BuiltinRoleName;
  description: string;
  isBuiltin: true;
  /** True iff this role is granted the given catalog entry. */
  grants: (entry: PermissionCatalogEntry) => boolean;
}

type CategoryGrants = Partial<
  Record<AdminPermissionCategory, AdminPermissionAction[]>
>;

function role(
  name: BuiltinRoleName,
  description: string,
  grants: CategoryGrants | "all",
): BuiltinRoleDef {
  return {
    name,
    description,
    isBuiltin: true,
    grants:
      grants === "all"
        ? () => true
        : (entry) => (grants[entry.category] ?? []).includes(entry.action),
  };
}

// Phase-0 grants. Later phases widen the per-category action sets as their
// surfaces (Config/Pricing/KYC/Users/Transactions/Compliance/…) are registered.
export const BUILTIN_ROLES: readonly BuiltinRoleDef[] = [
  role("super_admin", "Full, unrestricted access to every admin capability.", "all"),
  role("ops", "Operations: oversight and treasury actions; no access management.", {
    Audit: ["read"],
    Treasury: ["read", "execute"],
  }),
  role("compliance", "Compliance: KYC review, sanctions/AML, audit visibility.", {
    Audit: ["read"],
  }),
  role("finance", "Finance: pricing/economics, treasury, ledger, audit visibility.", {
    Audit: ["read"],
    Treasury: ["read", "execute"],
  }),
  role("support", "Support: read-only visibility into users and activity.", {}),
];
