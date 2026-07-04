/**
 * Shared card primitives for the admin surfaces (design §5). One canonical
 * `FeatureCard` shell + `CardHeading` title, previously copy-pasted into the
 * metrics/operator dashboards and the money-trend card (root §13.1 — one canonical
 * primitive per concept). Pure presentational; no data, no state.
 */
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** Feature card — radius 18px, 1px `--line` border, `--card` surface, 20/22 padding. */
export function FeatureCard({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-line bg-card px-[22px] py-5",
        className
      )}
    >
      {children}
    </div>
  )
}

/** Card title (14px/700) with an optional muted suffix line beneath. */
export function CardHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div>
      <div className="text-sm font-bold text-ink">{title}</div>
      {note && (
        <div className="mt-0.5 text-xs text-ink2 tabular-nums">{note}</div>
      )}
    </div>
  )
}
