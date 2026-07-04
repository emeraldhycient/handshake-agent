import { AppShell } from "@/components/admin/app-shell"
import { AmlPage } from "@/components/admin/aml-page"

/**
 * Composition only — AppShell centrally enforces auth + route permission.
 */
export default function AmlRoute() {
  return (
    <AppShell>
      <AmlPage />
    </AppShell>
  )
}
