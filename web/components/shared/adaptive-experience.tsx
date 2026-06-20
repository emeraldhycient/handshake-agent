"use client"

import { useIsDesktop } from "@/hooks/use-is-desktop"
import { BrandMark } from "./brand-mark"
import { DashboardExperience } from "@/components/desktop/dashboard-experience"
import { MobileShell } from "@/components/mobile/mobile-shell"

/**
 * Auto-selects the correct surface by viewport:
 *  - null  (pre-mount / SSR) → branded splash to avoid hydration mismatch
 *  - true  (lg+ / ≥1024px)  → DashboardExperience (desktop)
 *  - false (<lg)            → MobileShell (mobile chat app)
 *
 * Only ONE surface is mounted at a time — no double rendering.
 */
export function AdaptiveExperience() {
  const isDesktop = useIsDesktop()

  // ── Pre-mount splash — shown for one paint only; prevents hydration mismatch ──
  if (isDesktop === null) {
    return (
      <div className="flex h-svh w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          {/* Brand lockup — animated spark mark */}
          <BrandMark variant="spark" size={56} className="shadow-md" />
          <span className="text-base font-semibold tracking-tight text-foreground">
            Handshake Agent
          </span>
        </div>
      </div>
    )
  }

  // ── Desktop (lg+) ─────────────────────────────────────────────────────────
  if (isDesktop) {
    return <DashboardExperience />
  }

  // ── Mobile (<lg) ──────────────────────────────────────────────────────────
  return (
    <div className="h-svh w-full overflow-hidden bg-background">
      <MobileShell />
    </div>
  )
}
