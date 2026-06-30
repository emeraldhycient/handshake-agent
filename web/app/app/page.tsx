import { MobileShell } from "@/components/mobile/mobile-shell"
import { RequireAuth } from "@/components/auth/RequireAuth"
import { RequireVerified } from "@/components/auth/RequireVerified"

/**
 * /app route — full-bleed MobileShell.
 * Kept as a direct single-surface route so Playwright E2E can navigate here.
 *
 * Gated: unauthenticated users → /login (RequireAuth).
 *        authenticated but unverified → /onboarding (RequireVerified).
 */
export default function AppPage() {
  return (
    <RequireAuth>
      <RequireVerified>
        <main className="h-svh w-full overflow-hidden bg-background">
          <MobileShell />
        </main>
      </RequireVerified>
    </RequireAuth>
  )
}
