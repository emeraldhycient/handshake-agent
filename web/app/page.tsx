import { AdaptiveExperience } from "@/components/shared/adaptive-experience"
import { RequireAuth } from "@/components/auth/RequireAuth"

/**
 * `/` root route — auto-selects the right surface by viewport.
 * Below lg (1024px) → mobile chat app.
 * At lg+ → desktop dashboard.
 * No manual choice needed.
 *
 * Gated: unauthenticated users are redirected to /login by RequireAuth.
 */
export default function Home() {
  return (
    <RequireAuth>
      <AdaptiveExperience />
    </RequireAuth>
  )
}
