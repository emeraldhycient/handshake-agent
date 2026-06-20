"use client"

import { DashboardExperience } from "@/components/desktop/dashboard-experience"

/**
 * /dashboard route — delegates entirely to DashboardExperience.
 * Kept as a direct, single-surface route so Playwright E2E can navigate here.
 */
export default function DashboardPage() {
  return <DashboardExperience />
}
