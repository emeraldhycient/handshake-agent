"use client"

import { DashboardExperience } from "@/components/desktop/dashboard-experience"
import { RequireAuth } from "@/components/auth/RequireAuth"

/**
 * /dashboard route — delegates entirely to DashboardExperience.
 * Kept as a direct, single-surface route so Playwright E2E can navigate here.
 *
 * Gated: unauthenticated users are redirected to /login by RequireAuth.
 */
export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardExperience />
    </RequireAuth>
  )
}
