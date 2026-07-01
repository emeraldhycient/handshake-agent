"use client"

/**
 * UsersPage — the end-user directory (design §6, `docs/design-ref/screens/Users.html`).
 *
 * WIRED to real data: the design's 28-row module mock is replaced by
 * `useEndUsers(query)` (GET /admin/users → `AdminEndUserListResponse`). The layout,
 * tokens, spacing, pills and 7-column grid are preserved 1:1 — only the data source
 * changed. Phase-6b enrichment now backs the customer NAME (`displayName`), the
 * per-asset BALANCE summary (`balances`), the SANCTIONS risk flag (`sanctionsFlagged`),
 * and true LAST-ACTIVE (`lastActiveAt` — latest session/device/transaction, not
 * registration); the header also shows the server `total`. Still-unbacked shape gaps:
 * the Country column (no country field in the schema) and the VELOCITY risk flag
 * (no per-user breach state) render "—" / match nothing.
 *
 * Server-side filtering: the search box → `query`, the KYC-status select → `kycStatus`
 * (design bucket → contract status), the tier select → `kycTier`. The country select
 * and the sanctions/velocity risk chips have no matching query param, so they narrow
 * client-side over the fetched page (sanctions/simSwap chips map onto the row's real
 * booleans; velocity + country match nothing — shape gaps). Pagination is cursor/keyset
 * (the contract returns `nextCursor`) — the pager walks a cursor stack; the header
 * total comes from the response's filter-wide `total`.
 *
 * Four async branches: loading skeleton / error (inline, retryable) / empty / data.
 * The bulk-bar Tag / Message actions are now REAL step-up-guarded writes (Phase 7,
 * via `UsersBulkActions` → POST /admin/users/tags · /admin/users/message): a tag is
 * a pure annotation and a message enqueues onto the notifications outbox — nothing
 * here moves money (root §3.1). The header "Export CSV" and the bulk-bar Export
 * remain read-shaped toasts.
 */
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { pushToast } from "@/lib/store/toast-store"
import { FilterSelect } from "@/components/admin/filter-select"
import { UsersBulkActions } from "@/components/admin/users-bulk-actions"
import { Skeleton } from "@/components/ui/skeleton"
import { useEndUsers } from "@/lib/query/hooks"
import type {
  AdminEndUserListItem,
  AdminEndUserSearchQuery,
  KycTier,
} from "@handshake-agent/contracts"
import type {
  UserKycStatus,
  UserRiskChip,
  UserRiskFlag,
} from "@/types/components"

const PAGE_SIZE = 10
const MAX_WIDTH = "1360px"
const SEARCH_DEBOUNCE_MS = 250

// KYC bucket → pill tokens (design `kycMeta`). Tailwind token utilities, not raw hex.
// Colour is never the sole signal — the label carries state.
const KYC_META: Record<
  UserKycStatus,
  { label: string; bg: string; fg: string }
> = {
  verified: { label: "Verified", bg: "bg-sok", fg: "text-tok" },
  pending: { label: "Pending", bg: "bg-swn", fg: "text-twn" },
  needs_info: { label: "Needs info", bg: "bg-sif", fg: "text-tif" },
  rejected: { label: "Rejected", bg: "bg-sdn", fg: "text-tdn" },
}

// Contract `KycStatus` (not_started/pending/pending_review/verified/rejected/expired)
// → the design's four presentation buckets. `pending_review` and `not_started` map to
// the "Needs info" / "Pending" pills; `expired` reads as a rejected-style pill.
const KYC_STATUS_TO_BUCKET: Record<
  AdminEndUserListItem["kycStatus"],
  UserKycStatus
> = {
  not_started: "pending",
  pending: "pending",
  pending_review: "needs_info",
  verified: "verified",
  rejected: "rejected",
  expired: "rejected",
}

// The design's KYC-status filter buckets → the contract `KycStatus` sent to the
// server-side `kycStatus` param. One canonical status per bucket (the pending →
// `pending` and needs_info → `pending_review` cases are the meaningful splits);
// `not_started`/`expired` are not directly selectable from the four-bucket UI.
const KYC_BUCKET_TO_STATUS: Record<
  UserKycStatus,
  AdminEndUserListItem["kycStatus"]
> = {
  verified: "verified",
  pending: "pending",
  needs_info: "pending_review",
  rejected: "rejected",
}

// Risk flag → badge label + tokens (design `flagMeta`).
const FLAG_META: Record<
  UserRiskFlag,
  { label: string; full: string; bg: string; fg: string }
> = {
  simSwap: {
    label: "SIM-SWAP",
    full: "SIM-swap risk detected",
    bg: "bg-sdn",
    fg: "text-tdn",
  },
  sanctions: {
    label: "SANCTIONS",
    full: "Sanctions screening hit",
    bg: "bg-sdn",
    fg: "text-tdn",
  },
  velocity: {
    label: "VELOCITY",
    full: "Velocity cap breach",
    bg: "bg-swn",
    fg: "text-twn",
  },
}

// Filter-select option sets (design `uFilters`).
const KYC_OPTIONS = [
  { value: "all", label: "All KYC" },
  { value: "verified", label: "Verified" },
  { value: "pending", label: "Pending" },
  { value: "needs_info", label: "Needs info" },
  { value: "rejected", label: "Rejected" },
] as const

const TIER_OPTIONS = [
  { value: "all", label: "All tiers" },
  { value: "unverified", label: "unverified" },
  { value: "tier_1", label: "tier_1" },
  { value: "tier_2", label: "tier_2" },
  { value: "tier_3", label: "tier_3" },
] as const

const COUNTRY_OPTIONS = [
  { value: "all", label: "All countries" },
  { value: "NG", label: "Nigeria" },
  { value: "RW", label: "Rwanda" },
] as const

// Risk-toggle chips (design `riskDef`).
const RISK_DEFS: ReadonlyArray<{ value: UserRiskFlag; label: string }> = [
  { value: "simSwap", label: "SIM-swap" },
  { value: "sanctions", label: "Sanctions" },
  { value: "velocity", label: "Velocity" },
]

// The design's filter-select className: sits on the `--card` surface (not `--field`),
// with the 12.5px/600 filter type and 11px radius from Users.html line 20.
const FILTER_SELECT_CLASS =
  "h-[38px] w-auto min-w-0 rounded-[11px] border-line bg-card py-0 pr-[30px] pl-3 text-[12.5px] font-semibold"

// Shared 7-column grid (Users.html lines 44/52): checkbox · Customer · KYC · Country
// · Balance · Risk · Last active. Used verbatim by the header row and every body row.
const GRID_COLS =
  "grid grid-cols-[38px_2fr_1.1fr_0.9fr_1.2fr_1fr_1fr] items-center gap-3"

// Deterministic avatar hue palette (design `AVA`) — the list contract carries no
// avatar colour, so hue is derived from the id so a user keeps a stable colour.
const AVATAR_HUES = [
  "#2a6f55",
  "#c07a2a",
  "#3a6ea5",
  "#8a4b8a",
  "#b0563f",
  "#4a8a6a",
  "#7a6aa0",
  "#a0834a",
] as const

/** 1–2 letter initials from a display name (design `ini()`). */
function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Stable avatar hue from a user id (no colour field in the list contract). */
function avatarHue(id: string): string {
  let sum = 0
  for (let i = 0; i < id.length; i++) sum = (sum + id.charCodeAt(i)) % 997
  return AVATAR_HUES[sum % AVATAR_HUES.length]
}

/**
 * Relative "last active" label from a nullable ISO timestamp. Now sourced from
 * the contract's real `lastActiveAt` (latest session / device / transaction),
 * not the registration time. Null (never active) renders an em dash.
 */
function relativeTime(iso: string | null): string {
  if (!iso) return "—"
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "—"
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

/**
 * Compact balance label from the per-asset aggregate. Shows the primary asset's
 * amount + symbol (e.g. "100.50 USDT"); "+N" when the user holds more assets.
 * Native crypto amounts only — the contract carries no fiat total for the list.
 */
function balanceLabel(balances: AdminEndUserListItem["balances"]): string {
  const held = balances.filter((b) => Number(b.amount) > 0)
  if (held.length === 0) return "—"
  const [primary, ...rest] = held
  const amount = Number(primary.amount).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })
  const base = `${amount} ${primary.asset}`
  return rest.length > 0 ? `${base} +${rest.length}` : base
}

/** A presentation row derived from an `AdminEndUserListItem`. */
interface UsersRow {
  id: string
  name: string
  email: string
  initials: string
  avatar: string
  kyc: UserKycStatus
  tier: KycTier
  simSwapFlagged: boolean
  sanctionsFlagged: boolean
  balance: string
  lastActive: string
}

function toRow(item: AdminEndUserListItem): UsersRow {
  const name = item.displayName
  return {
    id: item.id,
    name,
    email: item.email ?? "—",
    initials: initialsOf(name),
    avatar: avatarHue(item.id),
    kyc: KYC_STATUS_TO_BUCKET[item.kycStatus],
    tier: item.kycTier,
    simSwapFlagged: item.simSwapFlagged,
    sanctionsFlagged: item.sanctionsFlagged,
    balance: balanceLabel(item.balances),
    lastActive: relativeTime(item.lastActiveAt),
  }
}

export function UsersPage() {
  const router = useRouter()

  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [kyc, setKyc] = useState("all")
  const [tier, setTier] = useState("all")
  const [country, setCountry] = useState("all")
  const [risk, setRisk] = useState<UserRiskFlag | "">("")
  const [selected, setSelected] = useState<readonly string[]>([])
  // Cursor stack for keyset pagination: [null, cursorForPage2, …]. The last entry
  // is the cursor that fetched the current page (null = first page).
  const [cursorStack, setCursorStack] = useState<readonly (string | null)[]>([
    null,
  ])

  // Debounce the free-text search before it hits the server-side `query` param (§7).
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search])

  // Reset to the first page whenever a filter changes (a new keyset window).
  function resetPaging() {
    setCursorStack([null])
  }

  const cursor = cursorStack[cursorStack.length - 1]
  const queryArg: AdminEndUserSearchQuery = useMemo(
    () => ({
      ...(debouncedSearch ? { query: debouncedSearch } : {}),
      // KYC status is now a server-side param (mapped from the design bucket).
      ...(kyc !== "all"
        ? { kycStatus: KYC_BUCKET_TO_STATUS[kyc as UserKycStatus] }
        : {}),
      ...(tier !== "all" ? { kycTier: tier as KycTier } : {}),
      ...(cursor ? { cursor } : {}),
      limit: PAGE_SIZE,
    }),
    [debouncedSearch, kyc, tier, cursor]
  )

  const { data, isLoading, isError, isSuccess, refetch, isFetching } =
    useEndUsers(queryArg)

  // The fetched page → presentation rows. Search / KYC-status / tier now filter
  // SERVER-side (query / kycStatus / kycTier params). The remaining client-only
  // narrowing is the risk chips (simSwap + sanctions are on the row) and country
  // (still not in the contract — a country selection matches nothing, a shape gap).
  const rows = useMemo(() => {
    const mapped = (data?.items ?? []).map(toRow)
    return mapped.filter((u) => {
      // Country is not in the list contract — a country filter can't match any row.
      if (country !== "all") return false
      if (risk === "simSwap" && !u.simSwapFlagged) return false
      if (risk === "sanctions" && !u.sanctionsFlagged) return false
      // Velocity breach is not modeled on the list item — no row can match.
      if (risk === "velocity") return false
      return true
    })
  }, [data, country, risk])

  const canPrev = cursorStack.length > 1
  const canNext = Boolean(data?.nextCursor)

  const allSelected = selected.length >= rows.length && rows.length > 0
  const hasSelection = selected.length > 0

  const riskChips: UserRiskChip[] = RISK_DEFS.map((r) => ({
    value: r.value,
    label: r.label,
    active: risk === r.value,
  }))

  function toggleRisk(value: UserRiskFlag) {
    setRisk((prev) => (prev === value ? "" : value))
    resetPaging()
  }

  function toggleSelect(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.length >= rows.length ? [] : rows.map((u) => u.id)
    )
  }

  function goNext() {
    if (!data?.nextCursor) return
    setSelected([])
    setCursorStack((prev) => [...prev, data.nextCursor])
  }

  function goPrev() {
    setSelected([])
    setCursorStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }

  function openUser(id: string) {
    router.push(`/users/${id}`)
  }

  const exportCount = selected.length || rows.length

  return (
    <div
      data-screen-label="Users"
      className="mx-auto px-[30px] pt-[26px] pb-[60px]"
      style={{ maxWidth: MAX_WIDTH }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-[18px] flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Users
          </h1>
          <p className="mt-[5px] mb-0 text-[13.5px] text-ink2">
            <span className="tabular-nums">{rows.length}</span> shown
            {typeof data?.total === "number" ? (
              <>
                {" · "}
                <span className="tabular-nums">
                  {data.total.toLocaleString()}
                </span>{" "}
                total
              </>
            ) : (
              canNext && " · more available"
            )}
          </p>
        </div>
        <div className="flex gap-[9px]">
          <button
            type="button"
            onClick={() =>
              pushToast(`Exporting ${exportCount} users to CSV…`, "info")
            }
            className="flex h-[38px] items-center gap-[7px] rounded-[11px] border border-line bg-card px-[15px] text-[13px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="mb-[14px] flex flex-wrap items-center gap-[10px]">
        <div className="flex h-[38px] min-w-[230px] items-center gap-2 rounded-[11px] border border-line bg-card px-3">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
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
            placeholder="Name, email, phone…"
            aria-label="Search users by name, email or phone"
            className="min-w-0 flex-1 border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink3"
          />
        </div>

        <FilterSelect
          label="Filter by KYC status"
          options={KYC_OPTIONS}
          value={kyc}
          onChange={(e) => {
            setKyc(e.target.value)
            resetPaging()
          }}
          className={FILTER_SELECT_CLASS}
        />
        <FilterSelect
          label="Filter by tier"
          options={TIER_OPTIONS}
          value={tier}
          onChange={(e) => {
            setTier(e.target.value)
            resetPaging()
          }}
          className={FILTER_SELECT_CLASS}
        />
        <FilterSelect
          label="Filter by country"
          options={COUNTRY_OPTIONS}
          value={country}
          onChange={(e) => {
            setCountry(e.target.value)
            resetPaging()
          }}
          className={FILTER_SELECT_CLASS}
        />

        {riskChips.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={c.active}
            onClick={() => toggleRisk(c.value)}
            className={cn(
              "flex h-[38px] items-center gap-[6px] rounded-[11px] border px-[13px] text-[12.5px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              c.active
                ? "border-btn-dark bg-btn-dark text-white"
                : "border-line bg-card text-ink2 hover:bg-hov"
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Bulk bar ───────────────────────────────────────────────────────── */}
      {hasSelection && (
        <div className="mb-3 flex items-center gap-[14px] rounded-[13px] bg-btn-dark px-4 py-[11px] text-white motion-safe:animate-hs-in">
          <span className="text-[13px] font-bold tabular-nums">
            {selected.length} selected
          </span>
          <div className="h-[18px] w-px bg-white/20" />
          <button
            type="button"
            onClick={() =>
              pushToast(`Exporting ${exportCount} users to CSV…`, "info")
            }
            className="text-[12.5px] font-semibold opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
          >
            Export
          </button>
          <UsersBulkActions
            selectedIds={selected}
            onDone={() => setSelected([])}
          />
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setSelected([])}
            className="text-[12.5px] font-semibold opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[16px] border border-line bg-card">
        {/* Header row */}
        <div
          className={cn(
            GRID_COLS,
            "border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase"
          )}
        >
          <button
            type="button"
            onClick={toggleSelectAll}
            aria-label={allSelected ? "Deselect all" : "Select all"}
            aria-pressed={allSelected}
            className="cursor-pointer justify-self-start focus-visible:outline-none"
          >
            <span
              aria-hidden
              className={cn(
                "inline-block size-4 rounded-[5px] border-[1.5px]",
                allSelected
                  ? "border-brand-green bg-brand-green"
                  : "border-line"
              )}
            />
          </button>
          <div>Customer</div>
          <div>KYC</div>
          <div>Country</div>
          <div className="text-right">Balance</div>
          <div>Risk</div>
          <div>Last active</div>
        </div>

        {/* Loading */}
        {isLoading &&
          Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                GRID_COLS,
                "min-h-[52px] border-b border-line2 px-[18px] last:border-b-0"
              )}
              aria-busy="true"
            >
              <Skeleton className="size-4 rounded-[5px]" />
              <div className="flex items-center gap-[11px]">
                <Skeleton className="size-8 flex-none rounded-full" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-2.5 w-40" />
                </div>
              </div>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-3 w-20 justify-self-end" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}

        {/* Error */}
        {isError && (
          <div className="px-5 py-[52px] text-center">
            <div className="text-[14px] font-bold text-tdn">
              Couldn&apos;t load users
            </div>
            <div className="mt-1 text-[12.5px] text-ink2">
              The directory failed to load. Check your connection and try again.
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-3 inline-flex h-[34px] items-center rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {isSuccess && rows.length === 0 && (
          <div className="px-5 py-[60px] text-center text-ink3">
            <div className="text-[14px] font-bold text-ink2">
              No users match these filters
            </div>
            <div className="mt-1 text-[12.5px]">
              Try clearing the risk chips or search.
            </div>
          </div>
        )}

        {/* Rows */}
        {isSuccess &&
          rows.map((u) => {
            const km = KYC_META[u.kyc]
            const isSelected = selected.includes(u.id)
            return (
              <div
                key={u.id}
                role="button"
                tabIndex={0}
                onClick={() => openUser(u.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    openUser(u.id)
                  }
                }}
                aria-label={`Open ${u.name}`}
                className={cn(
                  GRID_COLS,
                  "min-h-[52px] cursor-pointer border-b border-line2 px-[18px] transition-colors last:border-b-0 hover:bg-hov focus-visible:bg-hov focus-visible:outline-none"
                )}
              >
                {/* Checkbox */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleSelect(u.id)
                  }}
                  aria-label={
                    isSelected ? `Deselect ${u.name}` : `Select ${u.name}`
                  }
                  aria-pressed={isSelected}
                  className="justify-self-start focus-visible:outline-none"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block size-4 rounded-[5px] border-[1.5px]",
                      isSelected
                        ? "border-brand-green bg-brand-green"
                        : "border-line"
                    )}
                  />
                </button>

                {/* Customer */}
                <div className="flex min-w-0 items-center gap-[11px]">
                  <span
                    aria-hidden
                    className="flex size-8 flex-none items-center justify-center rounded-full text-[12px] font-extrabold text-white"
                    style={{ background: u.avatar }}
                  >
                    {u.initials}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold text-ink">
                      {u.name}
                    </div>
                    <div className="truncate text-[11px] text-ink3">
                      {u.email}
                    </div>
                  </div>
                </div>

                {/* KYC */}
                <div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-[5px] rounded-full px-[9px] py-[3px] text-[11px] font-bold",
                      km.bg,
                      km.fg
                    )}
                  >
                    {km.label}
                  </span>
                  <div className="mt-0.5 text-[10px] text-ink3">{u.tier}</div>
                </div>

                {/* Country — not in the list contract (shape gap) */}
                <div className="text-[12px] font-semibold text-ink3">—</div>

                {/* Balance — per-asset aggregate of cached wallet balances */}
                <div
                  className={cn(
                    "text-right text-[12.5px] font-bold tabular-nums",
                    u.balance === "—" ? "text-ink3" : "text-ink"
                  )}
                >
                  {u.balance}
                </div>

                {/* Risk — simSwap + sanctions are modeled on the list item */}
                <div className="flex flex-wrap gap-[4px]">
                  {u.simSwapFlagged && (
                    <span
                      title={FLAG_META.simSwap.full}
                      className={cn(
                        "rounded-[5px] px-[6px] py-[2px] text-[9.5px] font-extrabold tracking-[0.03em]",
                        FLAG_META.simSwap.bg,
                        FLAG_META.simSwap.fg
                      )}
                    >
                      {FLAG_META.simSwap.label}
                    </span>
                  )}
                  {u.sanctionsFlagged && (
                    <span
                      title={FLAG_META.sanctions.full}
                      className={cn(
                        "rounded-[5px] px-[6px] py-[2px] text-[9.5px] font-extrabold tracking-[0.03em]",
                        FLAG_META.sanctions.bg,
                        FLAG_META.sanctions.fg
                      )}
                    >
                      {FLAG_META.sanctions.label}
                    </span>
                  )}
                </div>

                {/* Last active — real latest session/device/transaction activity */}
                <div className="text-[11.5px] text-ink2 tabular-nums">
                  {u.lastActive}
                </div>
              </div>
            )
          })}
      </div>

      {/* ── Pagination — cursor/keyset Prev · Next (the contract has no total) ── */}
      {isSuccess && rows.length > 0 && (canPrev || canNext) && (
        <nav
          aria-label="Pagination"
          className="mx-auto mt-2 flex items-center justify-between gap-3 border-t border-line2 px-1 pt-3"
          style={{ maxWidth: MAX_WIDTH }}
        >
          <span className="text-xs text-ink3 tabular-nums">
            Showing {rows.length} · page {cursorStack.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={goPrev}
              disabled={!canPrev || isFetching}
              aria-label="Previous page"
              className={cn(
                "h-8 rounded-[9px] border border-line bg-card px-3 text-xs font-bold text-ink2 transition-colors hover:bg-hov focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                (!canPrev || isFetching) && "pointer-events-none opacity-45"
              )}
            >
              Prev
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={!canNext || isFetching}
              aria-label="Next page"
              className={cn(
                "h-8 rounded-[9px] border border-line bg-card px-3 text-xs font-bold text-ink2 transition-colors hover:bg-hov focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                (!canNext || isFetching) && "pointer-events-none opacity-45"
              )}
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </div>
  )
}
