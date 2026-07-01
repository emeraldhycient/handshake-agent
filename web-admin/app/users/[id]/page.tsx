import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { UserDetail } from "@/components/admin/user-detail"

/**
 * /users/[id] — end-user detail (design §6.3: profile / KYC / devices / security
 * / wallets / beneficiaries / transactions / chat / limits tabs). Gated by
 * RequireAuth + AppShell only — the design reproduction must be viewable, so no
 * RequirePermission gating. Composition only — the screen component (`UserDetail`)
 * consumes the awaited id.
 *
 * Next 16: route `params` is a Promise (async request API) — await it.
 */
export default async function UserDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <RequireAuth>
      <AppShell>
        <UserDetail userId={id} />
      </AppShell>
    </RequireAuth>
  )
}
