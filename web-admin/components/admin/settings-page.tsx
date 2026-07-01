"use client"

/**
 * SettingsPage — the layered-config (AppSetting) console (design §6.30 /
 * docs/design-ref/screens/Settings.html).
 *
 * "Every tunable key. Effective value resolves DB-admin › ENV › JSON. You may edit
 * the DB layer only — edits enter maker-checker, then hot-reload."
 *
 * DESIGN REPRODUCTION ONLY. This screen renders the design's OWN representative
 * content from a module-level `const` — it does NOT fetch real config (no
 * TanStack Query / useSettings here); real-data reintegration is a separate later
 * step. The rows mirror the seed `settings` array (docs/design-ref/logic.js lines
 * 96-105): reconciliation.cron.enabled, settlement.retry.maxAttempts,
 * kyc.tier2.dailyLimit.ngn, agent.model, provider.flutterwave.mockMode,
 * ticketing.commission.pct, sweep.threshold.trx, travelRule.threshold.usd.
 *
 * Faithful to the design markup: a single card with the exact 5-column grid
 * `1.5fr 1fr 0.7fr 1.5fr 0.9fr` — Key (mono + `{type} · by {by}`) · Effective
 * value (mono / tabular) · Source (a chain-tooltip chip whose `title` spells out
 * the full DB-admin › ENV › JSON resolution for that key) · Description · Edit.
 * A key-search box filters the rows client-side (presentation only).
 *
 * The Edit control is styled per editability, exactly as the design does:
 *  - DB-layer keys get an active Edit pill → opens the shared funds-safety flow
 *    chain reason (immutable audit) → step-up TOTP → maker-checker (dual control,
 *    the DB-override change enters Pending approval, then hot-reloads — §7).
 *  - ENV / JSON keys are read-only here (the DB layer is empty) → a muted "Locked"
 *    affordance; you cannot edit an env/JSON baseline from the console.
 * Wrapped in RequireAuth + AppShell upstream; presentation only (submit is a stub).
 */
import { useMemo, useState } from "react"

import {
  MakerCheckerModal,
  ReasonModal,
  StepUpModal,
} from "@/components/admin/flows"
import { cn } from "@/lib/utils"

// Design §6.30 table grid — Key / Effective value / Source / Description / Edit.
// Kept once and shared by the header row and every body row so columns line up
// pixel-for-pixel with the markup's `grid-template-columns:1.5fr 1fr 0.7fr 1.5fr 0.9fr`.
const SETTINGS_GRID = "grid-cols-[1.5fr_1fr_0.7fr_1.5fr_0.9fr]"

/** The three config layers a key's effective value can resolve from (design `s.src`). */
type SettingSource = "DB" | "ENV" | "JSON"

/** One design-reproduction settings row (matches Settings.html `settingRows`). */
interface SettingRow {
  /** The tunable key (mono) — the design's `s.key`. */
  key: string
  /** The resolved effective value (mono / tabular) — `s.val`. */
  val: string
  /** The winning config layer — `s.src` (DB overrides ENV overrides JSON). */
  src: SettingSource
  /** The value's type — shown in the key meta line, `s.type`. */
  type: string
  /** Registry description — `s.desc`. */
  desc: string
  /** The full DB › ENV › JSON resolution chain (tooltip on the source chip) — `s.chain`. */
  chain: readonly string[]
  /** Who last set the DB override, or "—" if none — `s.by`. */
  by: string
}

/**
 * The design's eight tunable keys (hint-placeholder-count="8"). Verbatim from the
 * seed `settings` array (docs/design-ref/logic.js lines 96-105) — representative
 * content that reproduces the design; no fetching.
 */
const SETTING_ROWS: readonly SettingRow[] = [
  {
    key: "reconciliation.cron.enabled",
    val: "true",
    src: "DB",
    type: "boolean",
    desc: "Nightly provider-vs-ledger reconciliation job",
    chain: ["DB: true", "ENV: (unset)", "JSON: false"],
    by: "Amara Okeke",
  },
  {
    key: "settlement.retry.maxAttempts",
    val: "5",
    src: "DB",
    type: "int",
    desc: "Max engine settlement retries before mark-failed",
    chain: ["DB: 5", "ENV: 3", "JSON: 3"],
    by: "Kelechi Chukwu",
  },
  {
    key: "kyc.tier2.dailyLimit.ngn",
    val: "2,000,000",
    src: "ENV",
    type: "int",
    desc: "Default tier_2 daily send cap (NGN)",
    chain: ["DB: (unset)", "ENV: 2,000,000", "JSON: 1,000,000"],
    by: "—",
  },
  {
    key: "agent.model",
    val: "claude-opus-4-8",
    src: "ENV",
    type: "string",
    desc: "LLM model id for the agent runtime",
    chain: ["DB: (unset)", "ENV: claude-opus-4-8", "JSON: claude-opus-4-8"],
    by: "—",
  },
  {
    key: "provider.flutterwave.mockMode",
    val: "false",
    src: "DB",
    type: "boolean",
    desc: "Route NGN rails through Flutterwave mock adapter",
    chain: ["DB: false", "ENV: true", "JSON: true"],
    by: "Amara Okeke",
  },
  {
    key: "ticketing.commission.pct",
    val: "6.5",
    src: "DB",
    type: "float",
    desc: "Platform commission on ticket sales (%)",
    chain: ["DB: 6.5", "ENV: (unset)", "JSON: 5.0"],
    by: "Tunde Adeyemi",
  },
  {
    key: "sweep.threshold.trx",
    val: "25",
    src: "JSON",
    type: "int",
    desc: "Child-address balance that triggers a sweep",
    chain: ["DB: (unset)", "ENV: (unset)", "JSON: 25"],
    by: "—",
  },
  {
    key: "travelRule.threshold.usd",
    val: "1,000",
    src: "JSON",
    type: "int",
    desc: "Transfer value that triggers Travel Rule records",
    chain: ["DB: (unset)", "ENV: (unset)", "JSON: 1,000"],
    by: "—",
  },
] as const

// Edit-pencil path used in the active Edit pill (design `s.editIcon` for DB keys).
const PENCIL_PATH =
  "M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
// Lock path used in the Edit column for read-only env/JSON-only keys.
const LOCK_PATH = "M6 10V7a6 6 0 1 1 12 0v3M5 10h14v10H5V10Z"

/**
 * A key is editable from the console only when its effective value comes from the
 * DB-admin layer — that is the one layer the admin can change (env/JSON are
 * infra/baseline, set outside the console). Matches the design, whose only Edit
 * pills sit on the `src:'DB'` rows.
 */
function isEditable(row: SettingRow): boolean {
  return row.src === "DB"
}

/**
 * The design's per-source chip tint (`s.srcBg`/`s.srcFg`), mapped to tokens: a DB
 * override is the top of the chain (info surface/text); ENV / JSON baselines resolve
 * to the neutral sub-surface. Colour is never the sole signal — the chip carries the
 * source label and the tooltip spells out the whole chain.
 */
function sourceTint(src: SettingSource): string {
  return src === "DB" ? "bg-sif text-tif" : "bg-card2 text-ink2"
}

/**
 * One body row of the design's settings grid (Settings.html markup) — the mono key +
 * `{type} · by {by}` meta, the mono effective value, the source chain-tooltip chip,
 * the description, and the per-editability Edit column.
 */
function SettingsTableRow({
  row,
  onEdit,
}: {
  row: SettingRow
  onEdit: (row: SettingRow) => void
}) {
  const editable = isEditable(row)
  const chainTitle = row.chain.join(" · ")
  return (
    <div
      className={cn(
        "grid items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0",
        SETTINGS_GRID
      )}
    >
      {/* Key + `{type} · by {by}` meta */}
      <div className="min-w-0">
        <div className="truncate font-mono text-[12px] font-bold text-ink">
          {row.key}
        </div>
        <div className="text-[10.5px] text-ink3">
          {row.type} · by {row.by}
        </div>
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
        {editable ? (
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
  const [search, setSearch] = useState("")
  // The key being edited + which flow step is open (reason → step-up → maker-checker).
  const [editing, setEditing] = useState<SettingRow | null>(null)
  const [step, setStep] = useState<"reason" | "stepup" | "maker" | null>(null)

  // Client-side key filter over the design rows (presentation only — never re-queries).
  const query = search.trim().toLowerCase()
  const visibleRows = useMemo(
    () =>
      query
        ? SETTING_ROWS.filter(
            (s) =>
              s.key.toLowerCase().includes(query) ||
              s.desc.toLowerCase().includes(query)
          )
        : SETTING_ROWS,
    [query]
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

        {/* Empty (after search filter) */}
        {visibleRows.length === 0 ? (
          <div className="px-[18px] py-10 text-center">
            <p className="text-[14px] font-bold text-ink">No matching keys</p>
            <p className="mt-1 text-[12.5px] text-ink3">
              No keys match “{search.trim()}”.
            </p>
          </div>
        ) : (
          visibleRows.map((row) => (
            <SettingsTableRow key={row.key} row={row} onEdit={startEdit} />
          ))
        )}
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
