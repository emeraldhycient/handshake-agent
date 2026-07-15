"use client"

import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useLogout } from "@/lib/query/auth"
import { Toast } from "@/components/shared/toast"
import { useToast } from "@/hooks/use-toast"
import { SettingsHeader } from "./settings-header"
import { MembershipCard } from "./membership-card"
import { AccountSection } from "./account-section"
import { SecuritySection } from "./security-section"
import { ConnectedAgentsSection } from "./connected-agents-section"
import { PreferencesSection } from "./preferences-section"
import type { SettingsPanelProps, SettingsDensity } from "@/types"

/**
 * Settings surface — density-aware orchestrator (root §16). Desktop renders the
 * standalone two-column passport layout; mobile renders an app-bar + scrolling
 * stack. Sections own their own data hooks + dialogs.
 */
export function SettingsPanel({
  density = "desktop",
  className,
  onBack,
  onAsk,
}: SettingsPanelProps) {
  const router = useRouter()
  const logout = useLogout()
  const { showToast } = useToast()

  const handleAsk =
    onAsk ?? (() => showToast("Open the chat to ask the agent."))

  async function handleLogout() {
    showToast("Logging out…")
    try {
      await logout.mutateAsync()
    } catch {
      // best-effort; the auth store is cleared regardless
    }
    router.push("/login")
  }

  const renderSections = (d: SettingsDensity) => (
    <>
      <AccountSection density={d} />
      <SecuritySection density={d} />
      <ConnectedAgentsSection density={d} />
      <PreferencesSection density={d} />
    </>
  )

  if (density === "mobile") {
    return (
      <div className={cn("relative flex h-full flex-col", className)}>
        <SettingsHeader density="mobile" onBack={onBack} onAsk={handleAsk} />
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-6 [background:var(--settings-bg-mobile)]">
          <div className="flex flex-col gap-5">
            <MembershipCard density="mobile" />
            {renderSections("mobile")}
            <LogOutButton density="mobile" onClick={handleLogout} />
          </div>
        </div>
        <Toast density="mobile" />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex-1 overflow-y-auto [background:var(--settings-bg-desktop)]",
        className
      )}
    >
      <div className="mx-auto max-w-[1180px] px-12 pt-10 pb-20">
        <SettingsHeader density="desktop" onAsk={handleAsk} />
        <div className="grid grid-cols-[352px_minmax(0,1fr)] items-start gap-11">
          <MembershipCard density="desktop" />
          <div className="flex flex-col gap-[26px]">
            {renderSections("desktop")}
            <LogOutButton density="desktop" onClick={handleLogout} />
          </div>
        </div>
      </div>
      <Toast density="desktop" />
    </div>
  )
}

function LogOutButton({
  density,
  onClick,
}: {
  density: "desktop" | "mobile"
  onClick: () => void
}) {
  const mobile = density === "mobile"
  return (
    <Button
      type="button"
      variant="outline"
      size="xl"
      onClick={onClick}
      aria-label="Log out"
      className={cn(
        "gap-[9px] border-settings-danger-border font-bold text-settings-danger hover:bg-settings-danger-bg hover:text-settings-danger",
        mobile ? "w-full" : "self-start"
      )}
    >
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
        <path
          d="M9 2v7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M5 4.6a6 6 0 108 0"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      Log out
    </Button>
  )
}
