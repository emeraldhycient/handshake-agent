import { RequireAuth } from "@/components/admin/require-auth"
import { AppShell } from "@/components/admin/app-shell"
import { AmlPage } from "@/components/admin/aml-page"

/**
 * /aml — AML / risk rules + open cases + Travel-Rule records (design §6.6). Gated by
 * RequireAuth + AppShell (auth still works); no RequirePermission gate so the design
 * reproduction is viewable. Composition only.
 */
export default function AmlRoute() {
  return (
    <RequireAuth>
      <AppShell>
        <AmlPage />
      </AppShell>
    </RequireAuth>
  )
}
