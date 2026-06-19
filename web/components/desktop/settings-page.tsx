"use client"

import { useState } from "react"
import { Switch } from "@/components/ui/switch"
import { AvatarPlaceholder } from "@/components/shared"
import { LANGUAGES } from "@/lib/constants"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type Language = (typeof LANGUAGES)[number]

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Desktop settings page.
 * Port of prototype lines 781–804.
 * Static — no hook reads, so no async branches needed.
 * Local state: faceId toggle + language pill selection.
 */
export function SettingsPage({ className }: { className?: string }) {
  const [faceIdOn, setFaceIdOn] = useState(true)
  const [language, setLanguage] = useState<Language>("English")

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

      {/* ── Profile card ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-[14px] rounded-[16px] border border-border bg-card px-5 py-[18px]">
        {/* Avatar — tokenized striped placeholder */}
        <AvatarPlaceholder size={48} />
        <div className="flex-1">
          <p className="text-base font-bold text-foreground">Amara Okeke</p>
          <p className="text-[13px] text-muted-foreground tabular-nums">
            +234 802 •••• 1123 · Lagos, NG
          </p>
        </div>
        <span className="rounded-full bg-success-muted px-3 py-1.5 text-xs font-bold text-success">
          Verified · Tier 3
        </span>
      </div>

      {/* ── Security section ─────────────────────────────────────────────────── */}
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

      {/* ── Language section ─────────────────────────────────────────────────── */}
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

      {/* ── Tier-3 daily limit ──────────────────────────────────────────────── */}
      <div className="flex items-center rounded-[16px] border border-border bg-card px-5 py-4">
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">
            Daily transfer limit
          </p>
          <p className="text-[12.5px] text-muted-foreground">Tier 3 verified</p>
        </div>
        <span className="text-[15px] font-extrabold text-foreground tabular-nums">
          ₦5,000,000
        </span>
      </div>
    </div>
  )
}
