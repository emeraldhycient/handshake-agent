"use client"

/**
 * KycReviewPage — the compliance reviewer's queue. Lists submissions awaiting
 * review (userId / email / status / submittedAt); clicking a row opens the
 * `KycSubmission` drawer to review and Approve / Reject.
 *
 * Presentation follows the operator-console design (§6.4): status tabs with
 * counts, an Applicant (avatar + name + id) / Status / SLA-age (colored) /
 * Review→ table, and an empty-bucket state.
 *
 * Four async branches on the queue query: loading / error / empty / data.
 */
import { useMemo, useState } from "react"
import type { KycQueueItem, KycStatus } from "@handshake-agent/contracts"

import { Skeleton } from "@/components/ui/skeleton"
import { KycStatusBadge } from "@/components/admin/user-status-badge"
import { KycSubmission } from "@/components/admin/kyc-submission"
import { useKycQueue } from "@/lib/query/hooks"
import { cn } from "@/lib/utils"

// Reviewer-relevant status buckets. "all" is the default view; the rest mirror
// the KYC lifecycle a compliance officer triages. Counts are derived from the
// already-fetched queue — no extra query.
const TABS: readonly { id: "all" | KycStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending_review", label: "Pending review" },
  { id: "pending", label: "Pending" },
  { id: "verified", label: "Verified" },
  { id: "rejected", label: "Rejected" },
]

function initials(item: KycQueueItem): string {
  const source = item.email ?? item.userId
  return source.slice(0, 2).toUpperCase()
}

function displayName(item: KycQueueItem): string {
  return item.email ?? "Unknown applicant"
}

/**
 * "SLA age" — how long the submission has waited. Colored by urgency so the
 * eye lands on stale items (never color as the sole signal — the text carries
 * the age). Green < 24h, amber < 72h, red beyond.
 */
function slaAge(iso: string | null): { label: string; className: string } {
  if (!iso) return { label: "—", className: "text-ink3" }
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000
  const label =
    hours < 1
      ? "< 1h"
      : hours < 24
        ? `${Math.floor(hours)}h`
        : `${Math.floor(hours / 24)}d`
  const className =
    hours < 24 ? "text-tok" : hours < 72 ? "text-twn" : "text-tdn"
  return { label, className }
}

const GRID = "grid grid-cols-[2fr_1fr_1fr_0.8fr] items-center gap-3"

export function KycReviewPage() {
  const queue = useKycQueue()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"all" | KycStatus>("all")

  const items = useMemo(() => queue.data?.items ?? [], [queue.data])

  const counts = useMemo(() => {
    const byStatus = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1
      return acc
    }, {})
    return (tabId: "all" | KycStatus) =>
      tabId === "all" ? items.length : (byStatus[tabId] ?? 0)
  }, [items])

  const visible = useMemo(
    () =>
      activeTab === "all"
        ? items
        : items.filter((item) => item.status === activeTab),
    [items, activeTab]
  )

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col overflow-y-auto px-8 py-7">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="mb-[18px]">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em] text-ink">
          KYC review queue
        </h1>
        <p className="mt-1.5 text-[13.5px] text-ink2">
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
              onClick={() => setActiveTab(tab.id)}
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
                {counts(tab.id)}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {queue.isLoading && (
        <div
          className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-4"
          aria-busy="true"
        >
          <Skeleton className="h-11 w-full rounded-md" />
          <Skeleton className="h-11 w-full rounded-md" />
          <Skeleton className="h-11 w-full rounded-md" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {queue.isError && (
        <div className="rounded-2xl border border-line bg-sdn/40 p-12 text-center">
          <p className="text-sm font-bold text-tdn">
            Failed to load the KYC queue
          </p>
          <p className="mt-1 text-[12.5px] text-ink3">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Data / Empty ─────────────────────────────────────────────────── */}
      {queue.isSuccess && (
        <div className="overflow-hidden rounded-2xl border border-line bg-card">
          <div
            className={cn(
              GRID,
              "border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase"
            )}
          >
            <div>Applicant</div>
            <div>Status</div>
            <div>SLA age</div>
            <div />
          </div>

          {/* Empty bucket */}
          {visible.length === 0 && (
            <div className="p-[50px] text-center text-[13px] text-ink3">
              {items.length === 0
                ? "No submissions awaiting review."
                : "Nothing in this bucket."}
            </div>
          )}

          {/* Rows */}
          {visible.map((item) => {
            const sla = slaAge(item.submittedAt)
            return (
              <div
                key={item.userId}
                role="button"
                tabIndex={0}
                aria-label={`Review ${item.email ?? item.userId}`}
                className={cn(
                  GRID,
                  "cursor-pointer border-b border-line2 px-[18px] py-[13px] hover:bg-hov focus-visible:bg-hov focus-visible:outline-none"
                )}
                onClick={() => setSelectedId(item.userId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    setSelectedId(item.userId)
                  }
                }}
              >
                <div className="flex items-center gap-[11px]">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-green text-xs font-extrabold text-white"
                  >
                    {initials(item)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold text-ink">
                      {displayName(item)}
                    </div>
                    <div className="truncate font-mono text-[10.5px] text-ink3">
                      {item.userId.slice(0, 8)}…
                    </div>
                  </div>
                </div>
                <div>
                  <KycStatusBadge status={item.status} />
                </div>
                <div
                  className={cn(
                    "text-[12.5px] font-bold tabular-nums",
                    sla.className
                  )}
                >
                  {sla.label}
                </div>
                <div className="text-right text-[11.5px] font-bold text-tif">
                  Review →
                </div>
              </div>
            )
          })}
        </div>
      )}

      <KycSubmission
        userId={selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      />
    </div>
  )
}
