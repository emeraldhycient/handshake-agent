"use client"

/**
 * KycReviewPage — the "KYC review queue" screen, reproduced 1:1 from the Operator
 * Console design (`docs/design-ref/screens/Kyc.html`, spec §6.4).
 *
 * DESIGN REPRODUCTION: this screen renders the design's OWN mock content (translated
 * from `logic.js` `vKyc()` + `seed()`), NOT live API data — real-data reintegration is
 * a separate later step. The queue values below (applicant names/ids/tiers, avatar
 * hues, SLA ages, assignees) are the exact rows the design emits for each status tab.
 *
 * Layout (Kyc.html): a 24px/800 title + 13.5px subtitle → a row of status pill-tabs,
 * each with a count badge (`kycTabs`) → a single card holding the queue table with the
 * design's 2fr·1fr·1fr·1fr·0.8fr grid — Applicant · Requested tier · SLA age · Assignee
 * · Review →. Rows are clickable and navigate to the applicant's user-detail KYC tab
 * (`openUserKyc` → `/users/[id]?tab=kyc`). Empty buckets show the design's copy. The
 * design paginates each bucket at 8 rows (`mkPager('kyc', …, 8)`), via the shared
 * Pagination primitive.
 */
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { Pagination } from "@/components/admin/pagination"
import type { KycQueueRow, KycQueueRowProps } from "@/types/components"
import { cn } from "@/lib/utils"

// ── Design mock data (logic.js `seed()` line 8-42) ──────────────────────────────
// The design seeds 28 users deterministically. `ini()` builds the 2-letter monogram;
// `AVA` is the avatar-hue palette (logic.js line 3). We reproduce the seed so the
// queue renders the SAME applicants the design shows.
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

const FIRST_NAMES = [
  "Amara",
  "Chidi",
  "Ngozi",
  "Emeka",
  "Ifeoma",
  "Tunde",
  "Bola",
  "Yusuf",
  "Fatima",
  "Kelechi",
  "Adaeze",
  "Obinna",
  "Zainab",
  "Segun",
  "Chinwe",
  "Uche",
  "Aisha",
  "Kunle",
  "Ada",
  "Musa",
  "Blessing",
  "Ibrahim",
  "Halima",
  "Femi",
  "Nneka",
  "Chuka",
  "Damilola",
  "Grace",
] as const

const LAST_NAMES = [
  "Okeke",
  "Adeyemi",
  "Balogun",
  "Okonkwo",
  "Eze",
  "Bello",
  "Nwosu",
  "Abubakar",
  "Ojo",
  "Danjuma",
  "Ibrahim",
  "Chukwu",
  "Mohammed",
  "Adebayo",
  "Okafor",
  "Yakubu",
  "Lawal",
  "Obi",
  "Sani",
  "Uche",
  "Oluwaseun",
  "Aliyu",
  "Nnamdi",
  "Kalu",
  "Effiong",
  "Musa",
  "Onyeka",
  "Adewale",
] as const

const TIERS = ["tier_1", "tier_2", "tier_3"] as const
// Per-index KYC status cycle (logic.js line 13); the first three users are forced
// to `pending` (line 19).
const KYC_STATUS = [
  "verified",
  "verified",
  "verified",
  "pending",
  "needs_info",
  "rejected",
  "verified",
  "pending",
] as const

/** The design's seeded PRNG (logic.js line 9) — `sin`-based, deterministic. */
function rnd(seed: number): number {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

/** Two-letter monogram from a name (logic.js `ini()`, line 333). */
function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
}

interface SeededUser {
  id: string
  name: string
  tier: string
  kyc: (typeof KYC_STATUS)[number] | "pending"
  avatar: string
}

/** The 28 seeded users (logic.js `seed()` loop, line 15-42). */
const SEEDED_USERS: SeededUser[] = Array.from({ length: 28 }, (_, i) => {
  const name = `${FIRST_NAMES[i]} ${LAST_NAMES[i]}`
  return {
    id: `usr_${10480 + i * 7}`,
    name,
    tier: TIERS[Math.floor(rnd(i + 7) * 3)],
    kyc: i < 3 ? "pending" : KYC_STATUS[i % KYC_STATUS.length],
    avatar: AVA[i % AVA.length],
  }
})

// ── Status tabs (logic.js `vKyc()` kycTabs, line 647) ───────────────────────────
// Each tab maps to a seed `kyc` value; the "approved" bucket is the design's
// `verified` status. Tab counts come from the seeded set (logic.js `cnt()`).
type TabId = "pending" | "needs_info" | "approved" | "rejected"

const TAB_STATUS: Record<TabId, SeededUser["kyc"]> = {
  pending: "pending",
  needs_info: "needs_info",
  approved: "verified",
  rejected: "rejected",
}

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "needs_info", label: "Needs info" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
]

/**
 * Build the queue rows for a tab (logic.js `vKyc()` avatarRows, line 645): filter the
 * seeded users by the tab's status, then derive the SLA age + assignee from the row
 * index exactly as the design does (`i%3` for SLA, `i%2` for assignee).
 */
function rowsForTab(tab: TabId): KycQueueRow[] {
  return SEEDED_USERS.filter((u) => u.kyc === TAB_STATUS[tab]).map((u, i) => ({
    name: u.name,
    id: u.id,
    initials: initialsOf(u.name),
    avatar: u.avatar,
    tier: u.tier,
    sla: i % 3 === 0 ? "2h" : i % 3 === 1 ? "6h" : "1d 4h",
    slaTone: i % 3 === 2 ? "danger" : "ink",
    assignee: i % 2 === 0 ? "Ifeoma Bello" : "Unassigned",
  }))
}

const COUNTS: Record<TabId, number> = {
  pending: rowsForTab("pending").length,
  needs_info: rowsForTab("needs_info").length,
  approved: rowsForTab("approved").length,
  rejected: rowsForTab("rejected").length,
}

// Design grid: Applicant 2fr · Requested tier 1fr · SLA age 1fr · Assignee 1fr ·
// Review→ 0.8fr, gap 12px (Kyc.html header + row).
const GRID = "grid grid-cols-[2fr_1fr_1fr_1fr_0.8fr] gap-3"
// The design paginates each bucket at 8 rows (`mkPager('kyc', …, 8, '1200px')`).
const PAGE_SIZE = 8

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

      {/* Requested tier */}
      <div>
        <span className="rounded-full bg-card2 px-[9px] py-[3px] text-[11px] font-bold text-ink2">
          {row.tier}
        </span>
      </div>

      {/* SLA age (colored by urgency — the label carries the age, never colour alone) */}
      <div
        className={cn(
          "text-[12.5px] font-bold tabular-nums",
          row.slaTone === "danger" ? "text-tdn" : "text-ink"
        )}
      >
        {row.sla}
      </div>

      {/* Assignee */}
      <div className="truncate text-[12px] text-ink2">{row.assignee}</div>

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

  const rows = useMemo(() => rowsForTab(activeTab), [activeTab])
  const pageRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page]
  )

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
                {COUNTS[tab.id]}
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

        {/* Empty bucket */}
        {rows.length === 0 ? (
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
