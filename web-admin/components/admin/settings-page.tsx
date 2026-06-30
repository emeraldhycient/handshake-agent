"use client"

/**
 * SettingsPage — the layered-config (AppSetting) console (root CLAUDE.md §7).
 *
 * Category tabs (Config / Pricing / Catalog / KYC / Compliance / Beneficiary)
 * each load that category's effective settings via `useSettings(category)` and
 * render them with `SettingField`. Every tab has all four async branches:
 * loading skeleton / error / empty / data.
 *
 * Pricing carries a fixed note that spreads are the company margin (never shown
 * to end users). Catalog's `catalog.capabilities.*` booleans render as switches —
 * this is service enablement (§7).
 *
 * Pure composition over the lib hooks; no data writes here (those live in
 * SettingField's mutation).
 */
import { useState } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { SettingField } from "@/components/admin/setting-field"
import { useSettings } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

// The SettingCategory enum from the registry. Kept as a local tuple (these are
// presentation labels for the tab strip, not a boundary shape).
const CATEGORIES = [
  "Config",
  "Pricing",
  "Catalog",
  "KYC",
  "Compliance",
  "Beneficiary",
] as const

type Category = (typeof CATEGORIES)[number]

export function SettingsPage() {
  const [active, setActive] = useState<Category>("Config")
  const settings = useSettings(active)

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Configuration
        </h1>
      </div>

      {/* ── Category tabs ────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Setting categories"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {CATEGORIES.map((category) => {
          const selected = category === active
          return (
            <button
              key={category}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(category)}
              className={cn(
                "-mb-px rounded-t-md border-b-2 px-3.5 py-2 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {category}
            </button>
          )
        })}
      </div>

      {/* ── Pricing margin note (root §3.1: spreads are the company margin) ──── */}
      {active === "Pricing" && (
        <div
          role="note"
          className="rounded-[14px] border border-info/30 bg-info/5 px-4 py-3 text-sm text-info-foreground"
        >
          Company margin — never shown to end users.
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {settings.isLoading && (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {settings.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load settings
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────────── */}
      {settings.isSuccess && settings.data.settings.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No settings in this category.
        </p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────────── */}
      {settings.isSuccess && settings.data.settings.length > 0 && (
        <div className="rounded-[14px] border border-border bg-card px-5">
          {settings.data.settings.map((setting) => (
            <SettingField key={setting.key} setting={setting} />
          ))}
        </div>
      )}
    </div>
  )
}
