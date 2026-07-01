"use client"

/**
 * SettingsPage — the layered-config (AppSetting) console (design §6.30 /
 * docs/design-ref/screens/Settings.html).
 *
 * "Every tunable key. Effective value resolves DB-admin › ENV › JSON. You may edit
 * the DB layer only — edits enter maker-checker, then hot-reload."
 *
 * WIRED (Phase 6a): the rows are the REAL effective settings from GET /admin/settings
 * (`useSettings()`), each row pairing a SETTING_REGISTRY entry's metadata (key /
 * category / label / valueType / editable) with its current effective value +
 * provenance (`source`: a 'db' override vs the 'default' baseline). The design's
 * three-way DB › ENV › JSON `chain` and the "by {admin}" attribution are NOT modeled
 * by the contract (source is a two-value 'db'|'default' enum, no ENV-vs-JSON split and
 * no updated-by admin), so those cells degrade gracefully — see the mapper + shapeGaps.
 *
 * Faithful to the design markup: a single card with the exact 5-column grid
 * `1.5fr 1fr 0.7fr 1.5fr 0.9fr` — Key (mono + `{type} · by {by}`) · Effective
 * value (mono / tabular) · Source (a chain-tooltip chip whose `title` spells out
 * the resolution for that key) · Description · Edit. A key-search box filters the
 * rows client-side (presentation only).
 *
 * The Edit control is styled per editability, exactly as the design does:
 *  - DB-layer keys get an active Edit pill → opens the shared funds-safety flow
 *    chain reason (immutable audit) → step-up TOTP → maker-checker (dual control).
 *  - ENV / JSON keys are read-only here (the DB layer is empty) → a muted "Locked"
 *    affordance; you cannot edit a baseline from the console.
 * Wrapped in RequireAuth + AppShell upstream. The edit SUBMIT is a stub (Phase 7);
 * this phase wires the READ path only. Four async branches: loading / error / empty / data.
 */
import { useMemo, useState } from "react"

import type { EffectiveSetting } from "@handshake-agent/contracts"

import {
  MakerCheckerModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import { Skeleton } from "@/components/ui/skeleton"
import { useSettings } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

// Design §6.30 table grid — Key / Effective value / Source / Description / Edit.
// Kept once and shared by the header row and every body row so columns line up
// pixel-for-pixel with the markup's `grid-template-columns:1.5fr 1fr 0.7fr 1.5fr 0.9fr`.
const SETTINGS_GRID = "grid-cols-[1.5fr_1fr_0.7fr_1.5fr_0.9fr]"

/**
 * The config layer a key's effective value resolved from. The backend models only
 * `db` (an admin override) vs `default` (the env/JSON baseline) — it does NOT split
 * ENV from JSON — so "DB" and "Baseline" are the two source labels we can surface.
 */
type SettingSource = "DB" | "Baseline"

/** One design-reproduction settings row, mapped from a real EffectiveSetting. */
interface SettingRow {
  /** The tunable key (mono) — `EffectiveSetting.key`. */
  key: string
  /** The resolved effective value, formatted (mono / tabular). */
  val: string
  /** The winning config layer — 'DB' for an override, else 'Baseline' (env/JSON). */
  src: SettingSource
  /** The value's type — shown in the key meta line (`valueType`). */
  type: string
  /** Registry description. */
  desc: string
  /** A human resolution line for the source chip tooltip. */
  chain: readonly string[]
  /**
   * Whether the row is editable from the console. The design only shows an Edit pill
   * on DB-layer rows (you can change the DB override, not the env/JSON baseline).
   */
  editable: boolean
}

// Edit-pencil path used in the active Edit pill (design `s.editIcon` for DB keys).
const PENCIL_PATH =
  "M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
// Lock path used in the Edit column for read-only baseline keys.
const LOCK_PATH = "M6 10V7a6 6 0 1 1 12 0v3M5 10h14v10H5V10Z"

/**
 * Render an effective value (whose runtime type matches its `valueType`) as the
 * mono display string the design shows. Numbers get grouped thousands; string[]
 * joins with a comma; booleans/strings stringify directly; nullish → "—".
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "number") return value.toLocaleString()
  if (typeof value === "boolean") return String(value)
  if (Array.isArray(value))
    return value.length === 0 ? "(empty)" : value.join(", ")
  return String(value)
}

/** Map one real EffectiveSetting onto the design's row shape. */
function toRow(s: EffectiveSetting): SettingRow {
  const isDb = s.source === "db"
  const val = formatValue(s.value)
  return {
    key: s.key,
    val,
    src: isDb ? "DB" : "Baseline",
    type: s.valueType,
    desc: s.description,
    // The contract exposes only db-override-vs-baseline, so the resolution line is
    // the two layers we can actually distinguish (no ENV-vs-JSON split — shapeGap).
    chain: isDb
      ? [`DB override: ${val}`, "Baseline (ENV / JSON): overridden"]
      : ["DB override: (none)", `Baseline (ENV / JSON): ${val}`],
    editable: s.editable && isDb,
  }
}

/**
 * The design's per-source chip tint (`s.srcBg`/`s.srcFg`), mapped to tokens: a DB
 * override is the top of the chain (info surface/text); the env/JSON baseline resolves
 * to the neutral sub-surface. Colour is never the sole signal — the chip carries the
 * source label and the tooltip spells out the resolution.
 */
function sourceTint(src: SettingSource): string {
  return src === "DB" ? "bg-sif text-tif" : "bg-card2 text-ink2"
}

/**
 * One body row of the design's settings grid (Settings.html markup) — the mono key +
 * `{type}` meta, the mono effective value, the source chain-tooltip chip, the
 * description, and the per-editability Edit column.
 */
function SettingsTableRow({
  row,
  onEdit,
}: {
  row: SettingRow
  onEdit: (row: SettingRow) => void
}) {
  const chainTitle = row.chain.join(" · ")
  return (
    <div
      className={cn(
        "grid items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0",
        SETTINGS_GRID
      )}
    >
      {/* Key + type meta */}
      <div className="min-w-0">
        <div className="truncate font-mono text-[12px] font-bold text-ink">
          {row.key}
        </div>
        <div className="text-[10.5px] text-ink3">{row.type}</div>
      </div>

      {/* Effective value (mono / tabular) */}
      <div
        className="truncate font-mono text-[12.5px] font-bold text-ink tabular-nums"
        title={row.val}
      >
        {row.val}
      </div>

      {/* Source chip (chain-resolution tooltip) */}
      <div>
        <span
          title={chainTitle}
          aria-label={`Source ${row.src}. Resolution — ${chainTitle}`}
          className={cn(
            "inline-flex cursor-help items-center gap-1.5 rounded-[6px] px-[9px] py-[3px] text-[10.5px] font-extrabold",
            sourceTint(row.src)
          )}
        >
          {row.src}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M12 16v-5M12 8h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
        </span>
      </div>

      {/* Description */}
      <div className="text-[11.5px] leading-[1.35] text-ink2">{row.desc}</div>

      {/* Edit column — styled per editability (design `s.edit*`) */}
      <div className="text-right">
        {row.editable ? (
          <button
            type="button"
            onClick={() => onEdit(row)}
            aria-label={`Edit ${row.key}`}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d={PENCIL_PATH}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Edit
          </button>
        ) : (
          <span
            aria-label="Locked — set via ENV or JSON, not editable from the console"
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-line2 bg-card2 px-3 py-[7px] text-[11.5px] font-bold text-ink3"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d={LOCK_PATH}
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Locked
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The from→to change a maker-checker request would apply for a DB-layer key. The
 * design's edit only proposes a change (blank target) — the real new value is
 * captured downstream; here we mirror the diff-preview shape.
 */
function settingDiff(
  row: SettingRow
): { field: string; from: string; to: string }[] {
  return [{ field: row.key, from: row.val, to: "—" }]
}

export function SettingsPage() {
  const query = useSettings()
  const rows = useMemo(() => (query.data ?? []).map(toRow), [query.data])

  const [search, setSearch] = useState("")
  // The key being edited + which flow step is open (reason → step-up → maker-checker).
  const [editing, setEditing] = useState<SettingRow | null>(null)
  const [step, setStep] = useState<"reason" | "stepup" | "maker" | null>(null)

  // Client-side key filter over the real rows (presentation only — never re-queries).
  const search_ = search.trim().toLowerCase()
  const visibleRows = useMemo(
    () =>
      search_
        ? rows.filter(
            (s) =>
              s.key.toLowerCase().includes(search_) ||
              s.desc.toLowerCase().includes(search_)
          )
        : rows,
    [rows, search_]
  )

  function startEdit(row: SettingRow) {
    setEditing(row)
    setStep("reason")
  }

  function closeFlow() {
    setStep(null)
    setEditing(null)
  }

  const flowTitle = editing ? `Edit ${editing.key}` : "Edit setting"

  return (
    <div className="mx-auto w-full max-w-[1300px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Settings
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Every tunable key. Effective value resolves DB-admin › ENV › JSON. You
          may edit the DB layer only — edits enter maker-checker, then
          hot-reload.
        </p>
      </div>

      {/* ── Key search (filters the rows; presentation only) ─────────────────── */}
      <div className="mb-3.5 flex h-[38px] max-w-[340px] items-center gap-2 rounded-[11px] border border-line bg-card px-3">
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
          className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink3"
        />
      </div>

      {/* ── Settings card (design 5-column grid table) ───────────────────────── */}
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

        {/* Loading */}
        {query.isLoading && (
          <div className="divide-y divide-line2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "grid items-center gap-3 px-[18px] py-[13px]",
                  SETTINGS_GRID
                )}
              >
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-16 rounded-[6px]" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="ml-auto h-8 w-16 rounded-[9px]" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {query.isError && (
          <div className="px-[18px] py-10 text-center">
            <p className="text-[14px] font-bold text-tdn">
              Failed to load settings
            </p>
            <p className="mt-1 text-[12.5px] text-ink3">
              The config registry could not be read.
            </p>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="mt-3 inline-flex items-center rounded-[9px] border border-line bg-card px-3 py-[7px] text-[11.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty (no keys, or none matched the search filter) */}
        {query.isSuccess && visibleRows.length === 0 && (
          <div className="px-[18px] py-10 text-center">
            <p className="text-[14px] font-bold text-ink">
              {rows.length === 0 ? "No tunable keys" : "No matching keys"}
            </p>
            <p className="mt-1 text-[12.5px] text-ink3">
              {rows.length === 0
                ? "The config registry is empty."
                : `No keys match “${search.trim()}”.`}
            </p>
          </div>
        )}

        {/* Data */}
        {query.isSuccess &&
          visibleRows.map((row) => (
            <SettingsTableRow key={row.key} row={row} onEdit={startEdit} />
          ))}
      </div>

      {/* ── Funds-safety flow chain: reason → step-up → maker-checker ─────────── */}
      <ReasonModal
        open={step === "reason"}
        onOpenChange={(next) => (next ? undefined : closeFlow())}
        title={flowTitle}
        onContinue={() => setStep("stepup")}
      />
      <StepUpModal
        open={step === "stepup"}
        onOpenChange={(next) => (next ? undefined : closeFlow())}
        title={flowTitle}
        onComplete={() => setStep("maker")}
      />
      <MakerCheckerModal
        open={step === "maker"}
        onOpenChange={(next) => (next ? undefined : closeFlow())}
        title={flowTitle}
        diff={editing ? settingDiff(editing) : []}
        onSubmit={closeFlow}
      />
    </div>
  )
}
