"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { LanguageSelector } from "@/components/shared"
import { useProfile, useLogout } from "@/lib/query/auth"
import { useConfig } from "@/lib/query/hooks"
import { formatFiatAmount } from "@/lib/format/money"
import { tierLabel } from "@/lib/format/tier"
import { cn } from "@/lib/utils"
import type { SettingsPanelProps } from "@/types"
import { ProfileSection } from "./profile-section"
import { SecuritySection } from "./security-section"
import { McpSection } from "./mcp-section"

/**
 * Shared settings body — used by the desktop settings page and the mobile
 * Settings tab. Orchestrator only (root §16.1): sections own their data +
 * dialogs; this file keeps the small Language / daily-limit / logout blocks
 * and composition.
 */
export function SettingsPanel({
  density = "desktop",
  className,
}: SettingsPanelProps) {
  const profile = useProfile()
  const config = useConfig()
  const logout = useLogout()
  const router = useRouter()
  const fiatSymbol =
    config.data?.fiats.find((f) => f.code === profile.data?.fiatCurrency)
      ?.symbol ?? ""

  function handleLogout() {
    logout.mutate(undefined, { onSettled: () => router.push("/login") })
  }

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-4 overflow-y-auto",
        density === "mobile" ? "p-4" : "p-6",
        className
      )}
    >
      <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
        Settings
      </h1>

      <ProfileSection />
      <SecuritySection />
      <McpSection />

      {/* Language — drives Google Translate */}
      <div className="rounded-[16px] border border-border bg-card px-5 py-4">
        <p className="mb-3 text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Language
        </p>
        <LanguageSelector />
        <p className="mt-2 text-[12px] text-muted-foreground">
          Translated automatically. Amounts and addresses are never translated.
        </p>
      </div>

      {/* Daily limit — real tier limits from /profile */}
      {profile.data?.limits && (
        <div className="flex items-center rounded-[16px] border border-border bg-card px-5 py-4">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              Daily transfer limit
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              {tierLabel(profile.data.kycTier)} verified
            </p>
          </div>
          <span className="text-[15px] font-extrabold text-foreground tabular-nums">
            {formatFiatAmount(
              String(profile.data.limits.dailyFiatMax),
              fiatSymbol
            )}
          </span>
        </div>
      )}

      <Button
        variant="outline"
        className="w-full rounded-[14px] border-danger/30 font-semibold text-danger hover:bg-danger/5 hover:text-danger"
        onClick={handleLogout}
        disabled={logout.isPending}
        aria-label="Log out"
      >
        {logout.isPending ? "Logging out…" : "Log out"}
      </Button>
    </div>
  )
}
