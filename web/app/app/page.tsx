import { MobileShell } from "@/components/mobile/mobile-shell"
import { RequireAuth } from "@/components/auth/RequireAuth"

/**
 * /app route — full-bleed MobileShell.
 * Kept as a direct single-surface route so Playwright E2E can navigate here.
 *
 * Gated: unauthenticated users are redirected to /login by RequireAuth.
 */
export default function AppPage() {
  return (
    <RequireAuth>
      <main className="h-svh w-full overflow-hidden bg-background">
        <MobileShell />
      </main>
    </RequireAuth>
  )
}
