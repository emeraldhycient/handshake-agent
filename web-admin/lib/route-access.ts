/**
 * The canonical route → access-requirement registry for the admin console.
 *
 * Every authenticated screen resolves its access here. Access is expressed as the
 * `menu_item` resourceId(s) that grant the route — the SAME unit the sidebar uses to
 * show/hide a nav item (app-shell), so "can see the nav link" and "can open the page"
 * stay in lock-step. `menu: null` means the route needs authentication only (Dashboard,
 * metrics, the operator's own admin-settings). `super_admin` is granted everything.
 *
 * This is UX gating: the API independently enforces every `api_route` permission
 * server-side (default-deny, root §3.3) — a determined client that bypasses this
 * still gets a 403 from the backend. Keeping the map here (pure data, no React) makes
 * the resolver unit-testable and keeps `lib/` free of component imports.
 */

export interface RouteAccess {
  /**
   * The menu resourceId(s) that grant the route; ANY match suffices. `null` → the
   * route is reachable by any authenticated admin (no per-route permission).
   */
  menu: string | string[] | null
}

/** Exact-path requirements for every static admin route. */
const STATIC_ROUTE_ACCESS: Readonly<Record<string, RouteAccess>> = {
  "/": { menu: null },
  "/metrics": { menu: null },
  "/admin-settings": { menu: null },
  // Customers
  "/users": { menu: "menu.users" },
  "/beneficiaries": { menu: "menu.users" },
  // Compliance
  "/kyc": { menu: ["menu.kyc", "menu.compliance"] },
  "/sanctions": { menu: ["menu.kyc", "menu.compliance"] },
  "/aml": { menu: ["menu.kyc", "menu.compliance"] },
  "/blocked": { menu: ["menu.kyc", "menu.compliance"] },
  "/compliance": { menu: ["menu.kyc", "menu.compliance"] },
  // Money
  "/transactions": { menu: "menu.transactions" },
  "/reconciliation": { menu: "menu.transactions" },
  "/ledger": { menu: "menu.ledger" },
  "/treasury": { menu: "menu.treasury" },
  // Configuration (the shared config surface gates on menu.config)
  "/settings": { menu: "menu.config" },
  "/pricing": { menu: "menu.config" },
  "/limits": { menu: "menu.config" },
  "/capabilities": { menu: "menu.config" },
  "/assets": { menu: "menu.config" },
  "/currencies": { menu: "menu.config" },
  "/providers": { menu: "menu.config" },
  "/flags": { menu: "menu.config" },
  // Channels
  "/templates": { menu: "menu.notifications" },
  "/notifications": { menu: "menu.notifications" },
  "/whatsapp": { menu: "menu.whatsapp" },
  // Commerce / Agent
  "/tickets": { menu: "menu.tickets" },
  "/agent": { menu: "menu.agent" },
  // Platform
  "/admins": { menu: "menu.access" },
  "/roles": { menu: "menu.access" },
  "/sessions": { menu: "menu.access" },
  "/approvals": { menu: "menu.access" },
  "/audit": { menu: "menu.audit" },
  "/ops": { menu: "menu.audit" },
}

/** Prefix requirements for dynamic/detail routes (`/users/[id]`, `/transactions/[id]`). */
const DYNAMIC_ROUTE_ACCESS: readonly { prefix: string; access: RouteAccess }[] = [
  { prefix: "/users/", access: { menu: "menu.users" } },
  { prefix: "/transactions/", access: { menu: "menu.transactions" } },
]

/**
 * Resolve the access requirement for a pathname. Unknown routes resolve to
 * `{ menu: null }` (authenticated-only) rather than blocking — the server is the real
 * gate, and a missing map entry must never hard-lock a legitimate authenticated page.
 */
export function routeAccessFor(pathname: string): RouteAccess {
  const exact = STATIC_ROUTE_ACCESS[pathname]
  if (exact) return exact
  for (const { prefix, access } of DYNAMIC_ROUTE_ACCESS) {
    if (pathname.startsWith(prefix)) return access
  }
  return { menu: null }
}

/**
 * Whether an operator with the given role + granted menus may open the route.
 * super_admin is always granted; a `null` requirement needs only authentication;
 * otherwise ANY of the route's menu(s) must be in the operator's granted menus.
 */
export function isRouteGranted(
  access: RouteAccess,
  roleName: string | undefined,
  menus: readonly string[]
): boolean {
  if (roleName === "super_admin") return true
  if (access.menu === null) return true
  const required = Array.isArray(access.menu) ? access.menu : [access.menu]
  return required.some((m) => menus.includes(m))
}
