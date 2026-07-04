"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AvatarPlaceholder, LanguageSelector } from "@/components/shared"
import { useProfile, useLogout } from "@/lib/query/auth"
import { useConfig } from "@/lib/query/hooks"
import { formatFiatAmount } from "@/lib/format/money"
import { cn } from "@/lib/utils"
import type { SettingsPanelProps } from "@/types/components"

function tierLabel(tier: string): string {
  if (tier === "unverified") return "Unverified"
  return tier.replace(/^tier_/, "Tier ")
}

/**
 * Shared settings body — used by the desktop settings page and the mobile
 * Settings tab. Profile card + daily limit come from GET /profile (four async
 * branches); Security (PIN/Face-ID) is UI-only; Language drives Google Translate
 * via the shared LanguageSelector.
 */
export function SettingsPanel({
  density = "desktop",
  className,
}: SettingsPanelProps) {
  const [faceIdOn, setFaceIdOn] = useState(true)
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

      {/* Profile card (loading / error / data) */}
      {profile.isLoading ? (
        <div className="flex items-center gap-[14px] rounded-[16px] border border-border bg-card px-5 py-[18px]">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-1.5 h-3 w-40" />
          </div>
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
      ) : profile.isError || !profile.data ? (
        <div className="rounded-[16px] border border-danger/20 bg-danger/5 px-5 py-[18px]">
          <p className="text-sm font-semibold text-danger">
            Could not load your profile.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-[14px] rounded-[16px] border border-border bg-card px-5 py-[18px]">
          <AvatarPlaceholder size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-foreground">
              {profile.data.fullName ?? profile.data.email}
            </p>
            {profile.data.phone ? (
              <p className="text-[13px] text-muted-foreground tabular-nums">
                {profile.data.phone}
              </p>
            ) : profile.data.fullName ? (
              <p className="truncate text-[13px] text-muted-foreground">
                {profile.data.email}
              </p>
            ) : null}
          </div>
          <span className="rounded-full bg-success-muted px-3 py-1.5 text-xs font-bold text-success">
            {profile.data.kycStatus === "verified"
              ? "Verified"
              : profile.data.kycStatus}{" "}
            · {tierLabel(profile.data.kycTier)}
          </span>
        </div>
      )}

      {/* Security (UI-only) */}
      <div className="overflow-hidden rounded-[16px] border border-border bg-card">
        <p className="border-b border-border px-5 py-[13px] text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Security
        </p>
        <div className="flex items-center border-b border-border px-5 py-[15px]">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              Transaction PIN
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              Required for every money movement
            </p>
          </div>
          <button
            type="button"
            className="cursor-pointer text-[13px] font-bold text-primary"
          >
            Change
          </button>
        </div>
        <div className="flex items-center px-5 py-[15px]">
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              Face ID / biometric
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              Use biometrics to approve payments
            </p>
          </div>
          <Switch
            checked={faceIdOn}
            onCheckedChange={setFaceIdOn}
            aria-label="Face ID / biometric toggle"
          />
        </div>
      </div>

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
