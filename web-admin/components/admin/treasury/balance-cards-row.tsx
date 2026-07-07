"use client"

import {
  BalanceCard,
  BalanceCardSkeleton,
} from "@/components/admin/treasury/balance-card"
import type { BalanceCardsRowProps } from "@/types/components"

/**
 * The 4-up balance-card row (custodial hero + fiat float + FX position + exposure
 * headroom). Its four reads share one error / loading branch so the row renders as a unit.
 */
export function BalanceCardsRow({
  cards,
  isLoading,
  isError,
  onRetry,
}: BalanceCardsRowProps) {
  if (isError) {
    return (
      <div className="mb-4 rounded-2xl border border-sdn bg-sdn/40 p-5 text-center">
        <p className="text-[13px] font-bold text-tdn">
          Failed to load treasury balances
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-[9px] bg-btn-dark px-3.5 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Retry
        </button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div
        className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4"
        aria-busy="true"
      >
        <BalanceCardSkeleton />
        <BalanceCardSkeleton />
        <BalanceCardSkeleton />
        <BalanceCardSkeleton />
      </div>
    )
  }

  return (
    <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {cards.map((card) => (
        <BalanceCard key={card.id} card={card} />
      ))}
    </div>
  )
}
