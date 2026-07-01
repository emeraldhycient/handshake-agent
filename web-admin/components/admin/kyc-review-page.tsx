"use client"

/**
 * KycReviewPage — the "KYC review queue" screen, reproduced 1:1 from the Operator
 * Console design (`docs/design-ref/screens/Kyc.html`, spec §6.4), now wired to the
 * real admin backend (`useKycQueue(status)` → GET /admin/kyc/queue?status=…).
 *
 * The queue endpoint takes a `status` filter, so each design tab maps onto a real
 * KYC-status bucket: Pending → `pending_review`, Needs info → `pending`,
 * Approved → `verified`, Rejected → `rejected`. All four buckets are queried so
 * every tab shows real rows and a real count badge. Each queue item is enriched
 * with the applicant's KYC display name, the requested (target) tier, and a
 * server-computed SLA age (seconds since submission).
 *
 * Layout (Kyc.html): a 24px/800 title + 13.5px subtitle → a row of status pill-tabs,
 * each with a count badge → a single card holding the queue table with the design's
 * 2fr·1fr·1fr·1fr·0.8fr grid — Applicant · Requested tier · SLA age · Assignee ·
 * Review →. Rows are clickable and navigate to the applicant's user-detail KYC tab
 * (`openUserKyc` → `/users/[id]?tab=kyc`). The design paginates each bucket at 8
 * rows, via the shared Pagination primitive.
 *
 * The one field the contract still does not carry (assignee) renders as a subtle
 * "—"; the avatar hue + monogram are derived deterministically from the applicant
 * (presentation only — no data invented). Four async branches: loading / error /
 * empty / data (§5).
 */
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { Pagination } from "@/components/admin/pagination"
import { Skeleton } from "@/components/ui/skeleton"
import type { KycQueueRow, KycQueueRowProps } from "@/types/components"
import { useKycQueue } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"
import type { KycQueueItem, KycStatus, KycTier } from "@handshake-agent/contracts"

// ── Avatar hue palette (design `AVA`, logic.js line 3) ──────────────────────────
// Presentation-only: a stable hue + monogram is derived from each applicant so the
// avatar column matches the design. This is styling, not fabricated queue data.
const AVA = [
  "#2a6f55",
  "#c07a2a",
  "#3a6ea5",
  "#8a4b8a",
  "#b0563f",
  "#4a8a6a",
  "#7a6aa0",
  "#a0834a",
] as const

/** Stable non-negative hash of a string → used to pick a deterministic avatar hue. */
function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/** Two-letter monogram from an applicant's email local-part (no name is surfaced). */
function initialsFromEmail(email: string | null): string {
  if (!email) return "?"
  const local = email.split("@")[0] ?? ""
  const parts = local.split(/[._-]+/).filter(Boolean)
  const letters =
    parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`
      : local.slice(0, 2) || "?"
  return letters.toUpperCase()
}

// ── Status tabs (design `kycTabs`, logic.js line 647) ───────────────────────────
// Each design tab maps onto a real KYC-status bucket, queried independently so the
// row list and the count badge are both live.
type TabId = "pending" | "needs_info" | "approved" | "rejected"

const TABS: readonly { id: TabId; label: string; status: KycStatus }[] = [
  { id: "pending", label: "Pending", status: "pending_review" },
  { id: "needs_info", label: "Needs info", status: "pending" },
  { id: "approved", label: "Approved", status: "verified" },
  { id: "rejected", label: "Rejected", status: "rejected" },
]

// The tier chip label the design shows (design `tierLabel`) — "unverified" reads as
// the tier-0 request, the numbered tiers as "Tier N".
const TIER_LABELS: Record<KycTier, string> = {
  unverified: "Unverified",
  tier_1: "Tier 1",
  tier_2: "Tier 2",
  tier_3: "Tier 3",
}

// The stalest bucket (design `slaFg` → `--tdn`): once a submission passes this age
// its SLA-age cell is tinted danger.
const SLA_DANGER_SECONDS = 24 * 60 * 60 // 1 day

/**
 * Format an SLA age (whole seconds) into the design's compact "2h" / "45m" /
 * "1d 4h" label. Presentation-only.
 */
function formatSla(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
}

/** Map one enriched backend queue item onto the design's row shape. The applicant
 *  name falls back to email; assignee is still not modeled (rendered "—"). */
function toQueueRow(item: KycQueueItem): KycQueueRow {
  return {
    name: item.displayName ?? item.email ?? item.userId,
    id: item.userId,
    initials: initialsFromEmail(item.email),
    avatar: AVA[hashString(item.userId) % AVA.length],
    tier: item.requestedTier ? TIER_LABELS[item.requestedTier] : "",
    sla: formatSla(item.slaAgeSeconds),
    slaTone: item.slaAgeSeconds >= SLA_DANGER_SECONDS ? "danger" : "ink",
    // Not provided by KycQueueItem — rendered as "—" (shape gap).
    assignee: "",
  }
}

// Design grid: Applicant 2fr · Requested tier 1fr · SLA age 1fr · Assignee 1fr ·
// Review→ 0.8fr, gap 12px (Kyc.html header + row).
const GRID = "grid grid-cols-[2fr_1fr_1fr_1fr_0.8fr] gap-3"
// The design paginates each bucket at 8 rows (`mkPager('kyc', …, 8, '1200px')`).
const PAGE_SIZE = 8
// A subtle placeholder for a design column the contract does not populate.
const MISSING = "—"

/** One queue row — the design's clickable applicant line (Kyc.html `kycRows`). */
function KycQueueRowLine({ row, onOpen }: KycQueueRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Review ${row.name}`}
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(row.id)
        }
      }}
      className={cn(
        GRID,
        "cursor-pointer items-center border-b border-line2 px-[18px] py-[13px] last:border-b-0 hover:bg-hov focus-visible:bg-hov focus-visible:outline-none"
      )}
    >
      {/* Applicant */}
      <div className="flex items-center gap-[11px]">
        <span
          aria-hidden="true"
          style={{ background: row.avatar }}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white"
        >
          {row.initials}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold text-ink">
            {row.name}
          </div>
          <div className="truncate font-mono text-[10.5px] text-ink3">
            {row.id}
          </div>
        </div>
      </div>

      {/* Requested tier (not provided by the queue contract) */}
      <div>
        {row.tier ? (
          <span className="rounded-full bg-card2 px-[9px] py-[3px] text-[11px] font-bold text-ink2">
            {row.tier}
          </span>
        ) : (
          <span className="text-[12px] text-ink3">{MISSING}</span>
        )}
      </div>

      {/* SLA age (not provided by the queue contract) */}
      <div
        className={cn(
          "text-[12.5px] font-bold tabular-nums",
          row.slaTone === "danger" ? "text-tdn" : "text-ink"
        )}
      >
        {row.sla || <span className="font-normal text-ink3">{MISSING}</span>}
      </div>

      {/* Assignee (not provided by the queue contract) */}
      <div className="truncate text-[12px] text-ink2">
        {row.assignee || <span className="text-ink3">{MISSING}</span>}
      </div>

      {/* Review → */}
      <div className="text-right text-[11.5px] font-bold text-tif">
        Review →
      </div>
    </div>
  )
}

export function KycReviewPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabId>("pending")
  const [page, setPage] = useState(1)

  // One query per status bucket (fixed order — safe for the Rules of Hooks) so
  // every tab has real rows and a real count badge.
  const pendingQuery = useKycQueue("pending_review")
  const needsInfoQuery = useKycQueue("pending")
  const approvedQuery = useKycQueue("verified")
  const rejectedQuery = useKycQueue("rejected")

  const queries: Record<TabId, ReturnType<typeof useKycQueue>> = {
    pending: pendingQuery,
    needs_info: needsInfoQuery,
    approved: approvedQuery,
    rejected: rejectedQuery,
  }
  const query = queries[activeTab]

  const rows = useMemo<KycQueueRow[]>(
    () => query.data?.items.map(toQueueRow) ?? [],
    [query.data]
  )

  const pageRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page]
  )

  // A tab's badge shows its bucket's real count once the query resolves; null
  // (rendered "—") while it is still loading or errored.
  const counts: Record<TabId, number | null> = {
    pending: pendingQuery.isSuccess ? pendingQuery.data.items.length : null,
    needs_info: needsInfoQuery.isSuccess
      ? needsInfoQuery.data.items.length
      : null,
    approved: approvedQuery.isSuccess ? approvedQuery.data.items.length : null,
    rejected: rejectedQuery.isSuccess ? rejectedQuery.data.items.length : null,
  }

  const selectTab = (id: TabId) => {
    setActiveTab(id)
    setPage(1)
  }

  // Design `openUserKyc`: open the applicant's user-detail KYC tab.
  const openUserKyc = (userId: string) =>
    router.push(`/users/${userId}?tab=kyc`)

  return (
    <div className="mx-auto w-full max-w-[1200px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="mb-[18px]">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          KYC review queue
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Applications awaiting a decision. Tier 2/3 approvals require a second
          approver.
        </p>
      </header>

      {/* ── Status tabs (counts) ─────────────────────────────────────────── */}
      <div
        className="mb-3.5 flex flex-wrap gap-[9px]"
        role="tablist"
        aria-label="KYC status"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          const count = counts[tab.id]
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab.id)}
              className={cn(
                "flex h-9 items-center gap-2 rounded-[10px] border px-3.5 text-[12.5px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                isActive
                  ? "border-btn-dark bg-btn-dark text-white"
                  : "border-line bg-card text-ink2 hover:bg-hov"
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "rounded-full px-[7px] py-px text-[10.5px] tabular-nums",
                  isActive ? "bg-white/20 text-white" : "bg-card2 text-ink3"
                )}
              >
                {count ?? MISSING}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Queue table ──────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-line bg-card">
        <div
          className={cn(
            GRID,
            "border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase"
          )}
        >
          <div>Applicant</div>
          <div>Requested tier</div>
          <div>SLA age</div>
          <div>Assignee</div>
          <div />
        </div>

        {/* Loading — skeleton rows matching the design row height */}
        {query.isLoading ? (
          <div aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  GRID,
                  "items-center border-b border-line2 px-[18px] py-[13px] last:border-b-0"
                )}
              >
                <div className="flex items-center gap-[11px]">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="h-2.5 w-20" />
                  </div>
                </div>
                <Skeleton className="h-4 w-14 rounded-full" />
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-24" />
                <div />
              </div>
            ))}
          </div>
        ) : query.isError ? (
          /* Error — tokened inline error with a retry affordance */
          <div className="p-[40px] text-center">
            <p className="text-[13px] font-bold text-tdn">
              Couldn&apos;t load the review queue
            </p>
            <p className="mt-1 text-[12.5px] text-ink2">
              Something went wrong fetching applicants in this bucket.
            </p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="mt-3 inline-flex h-9 items-center rounded-[10px] border border-line bg-card px-3.5 text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          /* Empty bucket (design copy) */
          <div className="p-[50px] text-center text-[13px] text-ink3">
            Nothing in this bucket.
          </div>
        ) : (
          pageRows.map((row) => (
            <KycQueueRowLine key={row.id} row={row} onOpen={openUserKyc} />
          ))
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      <Pagination
        total={rows.length}
        pageSize={PAGE_SIZE}
        page={page}
        onPageChange={setPage}
        maxWidth="1200px"
      />
    </div>
  )
}
