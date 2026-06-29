"use client"

import { useState } from "react"
import { Money } from "@/components/shared/money"
import { StatusPill } from "@/components/shared/status-pill"
import { Skeleton } from "@/components/ui/skeleton"
import { TransactionDetailModal } from "@/components/shared/transaction-detail-modal"
import { useActivity } from "@/lib/query/hooks"
import type { ActivityItem } from "@/lib/schemas"
import { cn } from "@/lib/utils"

// ─── Activity item row ────────────────────────────────────────────────────────

interface ActivityRowProps {
  item: ActivityItem
  idx: number
  /** Called when the user clicks the row — parallel tx-detail work handles routing. */
  onSelect?: (id: string) => void
}

function ActivityRow({ item, idx, onSelect }: ActivityRowProps) {
  return (
    <button
      key={item.id}
      type="button"
      data-tx-id={item.id}
      aria-label={`View details for ${item.title}`}
      onClick={() => onSelect?.(item.id)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-[13px] px-[18px] py-[14px] text-left",
        "transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
        idx > 0 && "border-t border-border"
      )}
    >
      {/* Icon */}
      <div
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] text-[17px] font-bold"
        style={{ backgroundColor: item.tint, color: item.col }}
        aria-hidden="true"
      >
        {item.icon}
      </div>
      {/* Body */}
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-bold text-foreground">{item.title}</p>
        <p className="text-[12.5px] text-muted-foreground tabular-nums">
          {item.sub}
        </p>
      </div>
      {/* Amount + status */}
      <div className="text-right">
        <Money
          value={item.amount}
          as="p"
          className="text-[14.5px] font-bold text-foreground"
        />
        <StatusPill tone={item.statusTone} className="mt-[3px] text-[10.5px]">
          {item.status}
        </StatusPill>
      </div>
    </button>
  )
}

// ─── Filter definitions ───────────────────────────────────────────────────────

type ActivityFilter = "all" | "received" | "sent" | "tickets"

const FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "received", label: "Received" },
  { id: "sent", label: "Sent" },
  { id: "tickets", label: "Tickets" },
]

function matchesFilter(item: ActivityItem, filter: ActivityFilter): boolean {
  if (filter === "all") return true
  if (filter === "received") return item.dir === "in"
  if (filter === "sent") return item.dir === "out"
  if (filter === "tickets") return item.dir === "ticket"
  return true
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Desktop activity page.
 * Port of prototype lines 721–744.
 * Local filter state (All/Received/Sent/Tickets) filters items by dir.
 * Four async branches: loading / error / empty / data.
 *
 * Clicking a row opens TransactionDetailModal with the full on-chain detail:
 * amount, asset, network, tx hash, block/confirmations, status, timestamp,
 * direction, fees, counterparty, and receipt number.
 */
export function ActivityPage({ className }: { className?: string }) {
  const [activeFilter, setActiveFilter] = useState<ActivityFilter>("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const activity = useActivity()

  // ── Loading state ──────────────────────────────────────────────────────────
  if (activity.isLoading) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col gap-4 overflow-y-auto p-6",
          className
        )}
      >
        <Skeleton className="h-8 w-28" />
        <div className="flex gap-2">
          {FILTERS.map((f) => (
            <Skeleton key={f.id} className="h-9 w-20 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-[180px] rounded-[16px]" />
        <Skeleton className="h-[180px] rounded-[16px]" />
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (activity.isError) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <div className="border-danger/20 bg-danger/5 rounded-[14px] border p-5 text-center">
          <p className="text-danger text-sm font-semibold">
            Failed to load activity
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      </div>
    )
  }

  const groups = activity.data ?? []

  // Filter groups → keep group if it has any items matching the filter
  const filteredGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => matchesFilter(it, activeFilter)),
    }))
    .filter((g) => g.items.length > 0)

  // ── Empty state ────────────────────────────────────────────────────────────
  if (groups.length === 0) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-4 overflow-y-auto p-6",
        className
      )}
    >
      {/* ── Page headline ───────────────────────────────────────────────────── */}
      <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
        Activity
      </h1>

      {/* ── Filter pills ────────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setActiveFilter(f.id)}
            className={cn(
              "cursor-pointer rounded-full border border-border px-4 py-2 text-[13px] font-semibold transition-colors",
              activeFilter === f.id
                ? "bg-foreground text-background"
                : "bg-card text-foreground hover:bg-muted"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Activity groups ─────────────────────────────────────────────────── */}
      {filteredGroups.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No {activeFilter === "all" ? "" : activeFilter} transactions.
        </p>
      )}
      {filteredGroups.map((g) => (
        <div key={g.group}>
          <p className="mb-[9px] ml-0.5 text-xs font-bold tracking-widest text-muted-foreground uppercase">
            {g.group}
          </p>
          <div className="overflow-hidden rounded-[16px] border border-border bg-card">
            {g.items.map((item, idx) => (
              <ActivityRow
                key={item.id}
                item={item}
                idx={idx}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        </div>
      ))}

      {/* ── Transaction detail modal ─────────────────────────────────────────── */}
      <TransactionDetailModal
        transactionId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}
