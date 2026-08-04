"use client"

/**
 * RouteGuard — the permission half of the centralized admin guard, applied ONCE
 * inside AppShell so EVERY authenticated screen is gated on load (no per-page
 * RequirePermission wrapper to remember). It resolves the current route's required
 * `menu_item` grant from the route-access registry and checks it against the
 * operator's `useAdminMe()` grants:
 *
 *  - super_admin holds everything;
 *  - an auth-only route (Dashboard / metrics / own admin-settings) always passes;
 *  - otherwise ANY of the route's required menus must be in `adminMe.menus`.
 *
 * This is UX gating; the API independently enforces every `api_route` permission
 * server-side (default-deny, root §3.3). While `useAdminMe()` loads we render a light
 * placeholder; a denied route shows a clear "no access" panel (chrome stays so the
 * operator can navigate away); on a load error we deny (we can't confirm the grant).
 */
import { usePathname } from "next/navigation"

import { useAdminMe } from "@/lib/query/hooks"
import { routeAccessFor, isRouteGranted } from "@/lib/route-access"
import type { RouteGuardProps } from "@/types"

export function RouteGuard({ children }: RouteGuardProps) {
  const pathname = usePathname()
  const me = useAdminMe()

  if (me.isLoading) {
    return (
      <div
        aria-busy="true"
        className="flex flex-1 items-center justify-center p-6 text-sm text-ink2"
      >
        Loading…
      </div>
    )
  }

  const granted = isRouteGranted(
    routeAccessFor(pathname),
    me.data?.role.name,
    me.data?.menus ?? []
  )

  if (!granted) {
    return (
      <div
        role="alert"
        className="flex flex-1 items-center justify-center p-6"
      >
        <div className="max-w-md rounded-[14px] border border-warn/30 bg-warn/5 p-6 text-center">
          <p className="text-sm font-semibold text-warn-foreground">
            You don&apos;t have access to this page
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Ask a super admin to grant your role the required permission.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
