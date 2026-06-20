import { MobileShell } from "@/components/mobile/mobile-shell"

/**
 * /app route — full-bleed MobileShell.
 * Kept as a direct single-surface route so Playwright E2E can navigate here.
 */
export default function AppPage() {
  return (
    <main className="h-svh w-full overflow-hidden bg-background">
      <MobileShell />
    </main>
  )
}
