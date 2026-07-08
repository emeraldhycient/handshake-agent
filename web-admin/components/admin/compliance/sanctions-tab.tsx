"use client"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useSanctions } from "@/lib/query/hooks"
import {
  ErrorPanel,
  LoadingRows,
  EmptyNote,
} from "@/components/admin/compliance/compliance-shells"
import { VERDICT_VARIANT } from "@/constants/compliance"
import { formatDate } from "@/lib/compliance/format"
import type { SanctionsCardProps } from "@/types/components"

/** A screening-run row rendered as the design's match card (red danger mark on a hit). */
function SanctionsCard({ record }: SanctionsCardProps) {
  const isHit = record.verdict === "hit"
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card p-4",
        isHit ? "border-sdn" : "border-line"
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-10 flex-none items-center justify-center rounded-xl",
            isHit ? "bg-sdn text-tdn" : "bg-card2 text-ink3"
          )}
          aria-hidden="true"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 4l9 16H3zM12 10v4M12 17h.01"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-bold text-ink">
            {record.counterpartyId}
          </div>
          <div className="text-[11.5px] text-ink2">
            Screened via <b className="font-bold">{record.provider}</b> ·{" "}
            {record.screeningType}
          </div>
        </div>
        <Badge variant={VERDICT_VARIANT[record.verdict]}>
          {record.verdict}
        </Badge>
        <span className="text-[11.5px] whitespace-nowrap text-ink3 tabular-nums">
          {formatDate(record.createdAt)}
        </span>
      </div>
    </div>
  )
}

/** Sanctions tab (§6.5) — the immutable screening-run history (read-only). */
export function SanctionsTab() {
  const sanctions = useSanctions()

  return (
    <div className="flex flex-col gap-3">
      <div
        role="note"
        className="rounded-2xl bg-sif px-4 py-3 text-[13px] text-tif"
      >
        The sanctions denylist is edited on the{" "}
        <a href="/settings" className="font-bold underline underline-offset-2">
          Settings page
        </a>{" "}
        (Compliance category). This is the immutable screening-run history.
      </div>

      {sanctions.isLoading && <LoadingRows />}
      {sanctions.isError && <ErrorPanel what="sanctions records" />}
      {sanctions.isSuccess && sanctions.data.items.length === 0 && (
        <EmptyNote>No sanctions records.</EmptyNote>
      )}
      {sanctions.isSuccess && sanctions.data.items.length > 0 && (
        <div className="flex flex-col gap-3">
          {sanctions.data.items.map((record) => (
            <SanctionsCard key={record.id} record={record} />
          ))}
        </div>
      )}
    </div>
  )
}
