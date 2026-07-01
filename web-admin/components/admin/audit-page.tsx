"use client"

/**
 * AuditPage — the immutable, hash-chained audit-log viewer, reproduced
 * pixel-for-pixel from the operator-console design
 * (`docs/design-ref/screens/Audit.html`, spec §6.10) and wired to real data.
 *
 * Reads (§ read-only): the paginated audit log via `useAudit(query)` and the
 * hash-chain integrity check via `useVerifyAuditChain()` (run once on mount so
 * the header pill reflects a real verify result). Four async branches on the
 * list: loading skeletons / error (with retry) / empty / data.
 *
 * Layout (design markup, `Audit.html`) is preserved 1:1:
 *   - Header: "Audit log" title + subtitle; a right cluster with the hash-chain
 *     pill (now data-driven) and an Export action (left as-is — Phase 7).
 *   - A rounded search field ("actor, target, action…") + an action filter + a
 *     date-range — all server-side (the DTO's `subject`/`action`/`from`/`to`).
 *   - One card holding the table: Actor (name + role) · Action (mono chip) ·
 *     Target (mono) · Before → after (strike-red → green) · Reason · Time.
 *   - Cursor keyset pagination via the DTO's `nextCursor` ("Load more").
 *
 * Shape reconciliation (see the gap matrix): the contract carries a flat `actor`
 * string but no per-actor role, and no dedicated `reason` — the role line and
 * reason cell fall back to a subtle "—" and are recorded as shapeGaps for the
 * later backend-enrichment pass. The design's `ip` column is never displayed.
 */
import { useEffect, useMemo, useState } from "react"

import { FilterSelect } from "@/components/admin/filter-select"
import { Skeleton } from "@/components/ui/skeleton"
import { useAudit, useVerifyAuditChain } from "@/lib/query/hooks"
import { pushToast } from "@/lib/store/toast-store"
import {
  AuditActionSchema,
  type AuditLogEntry,
  type AuditLogQuery,
} from "@handshake-agent/contracts"

// Page size for a single keyset page (design paginated at 6; keep it tight).
const PAGE_SIZE = 6

// Grid column template shared by the header row and every body row so the two
// stay aligned. Matches the design's `1.1fr 1fr 1.4fr 1.6fr 1.2fr 0.9fr`.
const GRID_COLS = "grid-cols-[1.1fr_1fr_1.4fr_1.6fr_1.2fr_0.9fr]"

// Action-filter options — an "All" sentinel plus every value of the contract's
// `AuditActionSchema` enum (kept in lock-step with the DTO, never hand-listed).
const ACTION_OPTIONS = [
  { value: "all", label: "All actions" },
  ...AuditActionSchema.options.map((a) => ({ value: a, label: a })),
] as const

// The design's filter-select className (Audit.html): `--card` surface, 11px
// radius, 12.5px/600 filter type — shared with the other console filter rows.
const FILTER_SELECT_CLASS =
  "h-[38px] w-auto min-w-0 rounded-[11px] border-line bg-card py-0 pr-[30px] pl-3 text-[12.5px] font-semibold"

/**
 * The design's `actColor(action)` helper (logic.js line 783): maps an action to
 * its mono-chip `[background, foreground]` token pair by keyword. Reproduced 1:1
 * as Tailwind token classes (var(--sdn)/var(--tdn) → bg-sdn/text-tdn, etc).
 */
function actionChip(action: string): string {
  if (/reject|freeze|fail|block|violation|override/.test(action))
    return "bg-sdn text-tdn"
  if (/pii/.test(action)) return "bg-sdn text-tdn"
  if (/config|update|pricing/.test(action)) return "bg-swn text-twn"
  if (/ledger|settle|credit|approve|confirm|execute|authorize/.test(action))
    return "bg-sok text-tok"
  return "bg-sif text-tif"
}

/** Render a nullable `unknown` before/after value as a compact display string. */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean")
    return String(value)
  return JSON.stringify(value)
}

/**
 * Pull a human reason from the entry's `details` bag if one is present — the
 * contract has no dedicated `reason` field (recorded as a shapeGap). Falls back
 * to "—" so the design's Reason column renders gracefully.
 */
function entryReason(details: Record<string, unknown>): string {
  const reason = details.reason
  return typeof reason === "string" && reason.length > 0 ? reason : "—"
}

/** Format the ISO `createdAt` as the design's mono "Mon D · HH:MM:SS" timestamp. */
function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const day = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  return `${day} · ${time}`
}

/** One rendered audit row (design body row markup — preserved 1:1). */
function AuditRow({ entry }: { entry: AuditLogEntry }) {
  return (
    <div
      className={`grid ${GRID_COLS} items-center gap-3 border-b border-line2 px-[18px] py-3 last:border-b-0`}
    >
      {/* Actor + role (role not carried by the contract → subtle em dash). */}
      <div className="min-w-0">
        <div
          className="truncate text-[12.5px] font-bold text-ink"
          title={entry.actor}
        >
          {entry.actor}
        </div>
        <div className="text-[10.5px] text-ink3">—</div>
      </div>
      {/* Action chip */}
      <div>
        <span
          className={`inline-flex rounded-[6px] px-2 py-0.5 font-mono text-[11px] font-bold ${actionChip(entry.action)}`}
        >
          {entry.action}
        </span>
      </div>
      {/* Target (contract `subject`) */}
      <div
        className="truncate font-mono text-[11.5px] text-ink2"
        title={entry.subject}
      >
        {entry.subject}
      </div>
      {/* Before → after */}
      <div className="text-[11.5px]">
        <span className="font-mono text-tdn line-through opacity-75">
          {displayValue(entry.before)}
        </span>{" "}
        <span className="font-mono font-bold text-tok">
          → {displayValue(entry.after)}
        </span>
      </div>
      {/* Reason (from `details.reason` when present, else em dash) */}
      <div className="text-[11.5px] text-ink2">
        {entryReason(entry.details)}
      </div>
      {/* Time */}
      <div className="font-mono text-[11px] text-ink3 tabular-nums">
        {formatTime(entry.createdAt)}
      </div>
    </div>
  )
}

export function AuditPage() {
  // Filter inputs (server-side): the search box maps onto the DTO's `subject`,
  // plus an action enum + a from/to date range. Debounced so typing doesn't
  // re-fetch on every keystroke.
  const [search, setSearch] = useState("")
  const [subject, setSubject] = useState("")
  const [action, setAction] = useState("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")

  // Keyset cursor stack: the last entry is the cursor for the current page; an
  // empty stack is the first (uncursored) page. Reset whenever a filter changes.
  const [cursors, setCursors] = useState<readonly string[]>([])
  const cursor = cursors.length > 0 ? cursors[cursors.length - 1] : undefined

  useEffect(() => {
    const timer = setTimeout(() => setSubject(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])

  const query = useMemo<AuditLogQuery>(
    () => ({
      ...(subject ? { subject } : {}),
      ...(action !== "all"
        ? { action: action as AuditLogQuery["action"] }
        : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(cursor ? { cursor } : {}),
      limit: PAGE_SIZE,
    }),
    [subject, action, from, to, cursor]
  )

  const audit = useAudit(query)
  const verify = useVerifyAuditChain()

  // Run the chain-integrity verify once on mount so the header pill is real.
  useEffect(() => {
    verify.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Any filter change resets keyset pagination back to the first page.
  function resetPaging() {
    setCursors([])
  }

  const items = audit.data?.items ?? []
  const nextCursor = audit.data?.nextCursor ?? null

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-1 flex-col overflow-y-auto px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header: title + subtitle · hash-chain pill + Export ─────────────── */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Audit log
          </h1>
          <p className="mt-[5px] text-[13.5px] text-ink2">
            Immutable record of every mutating action. Never editable, nothing
            hard-deleted.
          </p>
        </div>
        <div className="flex items-center gap-[9px]">
          <ChainPill verify={verify} />
          <button
            type="button"
            onClick={() => pushToast("Exporting audit log to CSV…", "info")}
            className="flex h-[34px] cursor-pointer items-center gap-[7px] rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Export
          </button>
        </div>
      </div>

      {/* ── Filters: search (→ subject) · action · date range ───────────────── */}
      <div className="mb-[14px] flex flex-wrap items-center gap-[10px]">
        <div className="flex h-[38px] min-w-[230px] items-center gap-2 rounded-[11px] border border-line bg-card px-3">
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
            onChange={(e) => {
              setSearch(e.target.value)
              resetPaging()
            }}
            placeholder="target, subject…"
            aria-label="Search audit log by target or subject"
            className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink3"
          />
        </div>
        <FilterSelect
          label="Filter by action"
          options={ACTION_OPTIONS}
          value={action}
          onChange={(e) => {
            setAction(e.target.value)
            resetPaging()
          }}
          className={FILTER_SELECT_CLASS}
        />
        <label className="flex h-[38px] items-center gap-2 rounded-[11px] border border-line bg-card px-3 text-[12px] text-ink2">
          <span className="text-ink3">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              resetPaging()
            }}
            aria-label="Filter from date"
            className="bg-transparent text-[12.5px] text-ink outline-none"
          />
        </label>
        <label className="flex h-[38px] items-center gap-2 rounded-[11px] border border-line bg-card px-3 text-[12px] text-ink2">
          <span className="text-ink3">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              resetPaging()
            }}
            aria-label="Filter to date"
            className="bg-transparent text-[12.5px] text-ink outline-none"
          />
        </label>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[16px] border border-line bg-card">
        {/* Header row */}
        <div
          className={`grid ${GRID_COLS} gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase`}
        >
          <div>Actor</div>
          <div>Action</div>
          <div>Target</div>
          <div>Before → after</div>
          <div>Reason</div>
          <div>Time</div>
        </div>

        {/* Loading */}
        {audit.isLoading && (
          <div className="flex flex-col" aria-busy="true">
            {Array.from({ length: PAGE_SIZE }).map((_, i) => (
              <div
                key={i}
                className={`grid ${GRID_COLS} items-center gap-3 border-b border-line2 px-[18px] py-3 last:border-b-0`}
              >
                <Skeleton className="h-8 w-full rounded-[6px]" />
                <Skeleton className="h-5 w-20 rounded-[6px]" />
                <Skeleton className="h-5 w-full rounded-[6px]" />
                <Skeleton className="h-5 w-full rounded-[6px]" />
                <Skeleton className="h-5 w-full rounded-[6px]" />
                <Skeleton className="h-5 w-24 rounded-[6px]" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {audit.isError && (
          <div className="px-5 py-[50px] text-center">
            <div className="text-[14px] font-bold text-tdn">
              Failed to load the audit log
            </div>
            <button
              type="button"
              onClick={() => audit.refetch()}
              className="mt-3 inline-flex h-[34px] items-center rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {audit.isSuccess && items.length === 0 && (
          <div className="px-5 py-[60px] text-center text-ink3">
            <div className="text-[14px] font-bold text-ink2">
              No audit entries match these filters
            </div>
            <div className="mt-1 text-[12.5px]">
              Try widening the date range or clearing the action filter.
            </div>
          </div>
        )}

        {/* Data */}
        {audit.isSuccess &&
          items.map((entry) => <AuditRow key={entry.id} entry={entry} />)}
      </div>

      {/* Keyset pagination — Prev / Load more over the DTO's `nextCursor`. */}
      {audit.isSuccess && (items.length > 0 || cursors.length > 0) && (
        <div className="mt-[14px] flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={cursors.length === 0 || audit.isFetching}
            onClick={() => setCursors((prev) => prev.slice(0, -1))}
            className="h-[34px] rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!nextCursor || audit.isFetching}
            onClick={() =>
              nextCursor && setCursors((prev) => [...prev, nextCursor])
            }
            className="h-[34px] rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {audit.isFetching ? "Loading…" : "Next"}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The header hash-chain pill — reflects the on-mount `useVerifyAuditChain`
 * result: a neutral "Verifying…" while pending, the green "Hash-chain verified"
 * on `ok`, and a red "Chain broken" banner (with the break point) otherwise.
 */
function ChainPill({
  verify,
}: {
  verify: ReturnType<typeof useVerifyAuditChain>
}) {
  if (verify.isPending || verify.isIdle) {
    return (
      <span className="flex h-[34px] items-center gap-[7px] rounded-full bg-card2 px-3 text-[11.5px] font-bold text-ink3">
        Verifying chain…
      </span>
    )
  }

  if (verify.isError || (verify.data && !verify.data.ok)) {
    const brokenAt = verify.data?.brokenAt
    return (
      <span
        className="flex h-[34px] items-center gap-[7px] rounded-full bg-sdn px-3 text-[11.5px] font-bold text-tdn"
        title={brokenAt ? `Broken at ${brokenAt}` : undefined}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M12 8v5m0 3v.5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
        Chain broken
      </span>
    )
  }

  return (
    <span className="flex h-[34px] items-center gap-[7px] rounded-full bg-sok px-3 text-[11.5px] font-bold text-tok">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path
          d="m9 12 2 2 4-4"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Hash-chain verified
    </span>
  )
}
