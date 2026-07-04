"use client"

import { SettingsPanel } from "@/components/settings/settings-panel"

/** Desktop settings route body — delegates to the shared panel. */
export function SettingsPage({ className }: { className?: string }) {
  return <SettingsPanel density="desktop" className={className} />
}
