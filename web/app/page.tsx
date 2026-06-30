import { AdaptiveExperience } from "@/components/shared/adaptive-experience"
import { RequireAuth } from "@/components/auth/RequireAuth"
import { RequireVerified } from "@/components/auth/RequireVerified"

/**
 * `/` root route — auto-selects the right surface by viewport.
 * Below lg (1024px) → mobile chat app.
 * At lg+ → desktop dashboard.
 * No manual choice needed.
 *
 * Gated: unauthenticated users → /login (RequireAuth).
 *        authenticated but unverified → /onboarding (RequireVerified).
 */
export default function Home() {
  return (
    <RequireAuth>
      <RequireVerified>
        <AdaptiveExperience />
      </RequireVerified>
    </RequireAuth>
  )
}
