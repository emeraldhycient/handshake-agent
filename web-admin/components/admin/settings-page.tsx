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
 * SettingField's mutation). A key-search box filters the loaded rows client-side
 * (presentation only — it never re-queries).
 */
import { useMemo, useState } from "react"

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

// Design §6.30 table grid — Key / Effective value / Source / Description / Edit.
const SETTINGS_GRID = "grid-cols-[1.5fr_1fr_0.7fr_1.5fr_0.9fr]"

export function SettingsPage() {
  const [active, setActive] = useState<Category>("Config")
  const [search, setSearch] = useState("")
  const settings = useSettings(active)

  // Client-side key filter over the loaded rows (presentation only).
  const loadedRows = settings.data?.settings
  const query = search.trim().toLowerCase()
  const rows = useMemo(() => loadedRows ?? [], [loadedRows])
  const visibleRows = useMemo(
    () =>
      query ? rows.filter((s) => s.key.toLowerCase().includes(query)) : rows,
    [rows, query]
  )

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-bg p-[26px_30px_60px]">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Settings
        </h1>
        <p className="mt-1.5 text-[13.5px] text-ink2">
          Every tunable key. Effective value resolves DB-admin › ENV › JSON. You
          may edit the DB layer only — edits enter maker-checker, then
          hot-reload.
        </p>
      </div>

      {/* ── Category tabs ────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Setting categories"
        className="flex flex-wrap gap-2"
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
                "rounded-[10px] border px-4 py-[9px] text-[12.5px] font-bold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                selected
                  ? "border-btn-dark bg-btn-dark text-white"
                  : "border-line bg-card text-ink2 hover:bg-hov"
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
          className="rounded-[14px] border border-sif bg-sif px-4 py-3 text-[12.5px] font-semibold text-tif"
        >
          Company margin — never shown to end users.
        </div>
      )}

      {/* ── Key search (filters loaded rows; presentation only) ──────────────── */}
      <div className="flex h-[38px] max-w-[340px] items-center gap-2 rounded-[11px] border border-line bg-card px-3">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="text-ink3"
        >
          <circle
            cx="11"
            cy="11"
            r="7"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="m20 20-3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search keys…"
          aria-label="Search settings keys"
          className="flex-1 border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink3"
        />
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {settings.isLoading && (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-16 w-full rounded-[14px]" />
          <Skeleton className="h-16 w-full rounded-[14px]" />
          <Skeleton className="h-16 w-full rounded-[14px]" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {settings.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn p-5 text-center">
          <p className="text-sm font-bold text-tdn">Failed to load settings</p>
          <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────────── */}
      {settings.isSuccess && rows.length === 0 && (
        <p className="text-[12.5px] text-ink3">No settings in this category.</p>
      )}

      {/* ── Empty (after search filter) ──────────────────────────────────────── */}
      {settings.isSuccess && rows.length > 0 && visibleRows.length === 0 && (
        <p className="text-[12.5px] text-ink3">
          No keys match “{search.trim()}”.
        </p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────────── */}
      {settings.isSuccess && visibleRows.length > 0 && (
        <div className="overflow-hidden rounded-[16px] border border-line bg-card">
          {/* Column header row (design grid) */}
          <div
            className={cn(
              "grid gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
              SETTINGS_GRID
            )}
          >
            <div>Key</div>
            <div>Effective value</div>
            <div>Source</div>
            <div>Description</div>
            <div aria-hidden="true" />
          </div>
          {visibleRows.map((setting) => (
            <SettingField
              key={setting.key}
              setting={setting}
              gridClassName={SETTINGS_GRID}
            />
          ))}
        </div>
      )}
    </div>
  )
}
