"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AvatarPlaceholder } from "@/components/shared"
import { useProfile, useLogout } from "@/lib/query/auth"
import { useConfig } from "@/lib/query/hooks"
import { formatFiatAmount } from "@/lib/format/money"
import { LANGUAGES } from "@/lib/constants"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Language = (typeof LANGUAGES)[number]

function tierLabel(tier: string): string {
  if (tier === "unverified") return "Unverified"
  return tier.replace(/^tier_/, "Tier ")
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Desktop settings page.
 * Profile card + daily limit are driven by GET /profile (useProfile) with four
 * async branches; Security (PIN/Face-ID) and Language are UI-only controls.
 */
export function SettingsPage({ className }: { className?: string }) {
  const [faceIdOn, setFaceIdOn] = useState(true)
  const [language, setLanguage] = useState<Language>("English")
  const profile = useProfile()
  const config = useConfig()
  const logout = useLogout()
  const router = useRouter()
  const fiatSymbol =
    config.data?.fiats.find((f) => f.code === profile.data?.fiatCurrency)
      ?.symbol ?? ""

  function handleLogout() {
    logout.mutate(undefined, {
      onSettled: () => router.push("/login"),
    })
  }

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-4 overflow-y-auto p-6",
        className
      )}
    >
      {/* ── Page headline ───────────────────────────────────────────────────── */}
      <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
        Settings
      </h1>

      {/* ── Profile card (loading / error / data) ───────────────────────────── */}
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
        <div className="border-danger/20 bg-danger/5 rounded-[16px] border px-5 py-[18px]">
          <p className="text-danger text-sm font-semibold">
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
              // Show the email as a secondary line only when the name line isn't
              // already the email (avoids rendering the email twice).
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

      {/* ── Security section (UI-only) ──────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[16px] border border-border bg-card">
        <p className="border-b border-border px-5 py-[13px] text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Security
        </p>
        {/* Transaction PIN row */}
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
        {/* Face ID row */}
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

      {/* ── Language section (UI-only) ──────────────────────────────────────── */}
      <div className="rounded-[16px] border border-border bg-card px-5 py-4">
        <p className="mb-3 text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Language
        </p>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((lang) => {
            const isSelected = language === lang
            return (
              <button
                key={lang}
                type="button"
                data-active={isSelected ? "true" : "false"}
                onClick={() => setLanguage(lang)}
                className={cn(
                  "cursor-pointer rounded-full border border-border px-4 py-2 text-[13px] font-semibold transition-colors",
                  isSelected
                    ? "bg-foreground text-background"
                    : "bg-card text-foreground hover:bg-muted"
                )}
              >
                {lang}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Daily limit — real tier limits from /profile ────────────────────── */}
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

      {/* ── Logout ─────────────────────────────────────────────────────────── */}
      <Button
        variant="outline"
        className="border-danger/30 text-danger hover:bg-danger/5 hover:text-danger w-full rounded-[14px] font-semibold"
        onClick={handleLogout}
        disabled={logout.isPending}
        aria-label="Log out"
      >
        {logout.isPending ? "Logging out…" : "Log out"}
      </Button>
    </div>
  )
}
