import { AppShell } from "@/components/admin/app-shell"
import { UserDetail } from "@/components/admin/user-detail"

/**
 * /users/[id] — end-user detail (design §6.3: profile / KYC / devices / security
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default async function UserDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <AppShell>
      <UserDetail userId={id} />
    </AppShell>
  )
}
