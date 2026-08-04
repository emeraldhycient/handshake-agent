"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { DOT_CLASS, HERO_GRADIENT } from "@/constants/treasury"
import type { BalanceCardProps } from "@/types"

/** A single balance tile — the hero variant carries the dark-green gradient. */
export function BalanceCard({ card }: BalanceCardProps) {
  const hero = card.tone === "hero"
  return (
    <div
      style={hero ? { background: HERO_GRADIENT } : undefined}
      className={
        hero
          ? "rounded-2xl border border-transparent px-[18px] py-4 text-white"
          : "rounded-2xl border border-line bg-card px-[18px] py-4 text-ink"
      }
    >
      <div
        className={
          hero
            ? "text-[11.5px] font-semibold text-on-brand-muted"
            : "text-[11.5px] font-semibold text-ink3"
        }
      >
        {card.label}
      </div>
      <div className="mt-[5px] font-mono text-[21px] font-extrabold tracking-[-0.01em] tabular-nums">
        {card.value}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`size-[7px] shrink-0 rounded-full ${
            hero ? "bg-brand-amber" : DOT_CLASS[card.dot]
          }`}
        />
        <span
          className={
            hero ? "text-[11px] text-on-brand-muted" : "text-[11px] text-ink3"
          }
        >
          {card.note}
        </span>
      </div>
    </div>
  )
}

/** A single balance-tile skeleton matching the tile's height + radius. */
export function BalanceCardSkeleton() {
  return <Skeleton className="h-[104px] rounded-2xl" />
}
