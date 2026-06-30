"use client"

/**
 * RequirePermission — hides a page body when the page's `web_page` resourceId is
 * not in `adminMe.pages`. This is UX gating only; the API still enforces every
 * `api_route` permission server-side (default-deny). When the grant is absent we
 * render a clear "no access" panel instead of the page content.
 *
 * While `useAdminMe()` is loading we render nothing (the surrounding RequireAuth
 * shell already shows the chrome); on error we also deny, since we can't confirm
 * the grant.
 */
import { useAdminMe } from "@/lib/query/hooks"
import type { RequirePermissionProps } from "@/types/components"

export function RequirePermission({ page, children }: RequirePermissionProps) {
  const me = useAdminMe()

  if (me.isLoading) return null

  const granted = me.data?.pages.includes(page) ?? false

  if (!granted) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
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
