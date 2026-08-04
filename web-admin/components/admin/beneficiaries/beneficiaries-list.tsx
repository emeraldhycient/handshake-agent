import { Wallet } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import type { BeneficiariesListProps } from "@/types"

import { BeneficiaryRow } from "./beneficiary-row"

/**
 * The beneficiaries list card — the four async branches (loading skeletons / error /
 * empty / the row list) over the (optionally user-scoped) beneficiaries read.
 */
export function BeneficiariesList({
  isLoading,
  isError,
  isSuccess,
  items,
}: BeneficiariesListProps) {
  if (isLoading) {
    return (
      <div
        className="flex flex-col gap-2 rounded-2xl border border-line bg-card p-5"
        aria-busy="true"
      >
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-line bg-sdn p-5 text-center">
        <p className="text-sm font-bold text-tdn">
          Failed to load beneficiaries
        </p>
        <p className="mt-1 text-xs text-ink3">Please refresh the page.</p>
      </div>
    )
  }

  if (!isSuccess) return null

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-card px-5 py-12 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-card2 text-ink3">
          <Wallet aria-hidden="true" className="size-5" />
        </span>
        <p className="text-sm font-bold text-ink">No beneficiaries</p>
        <p className="text-[12.5px] text-ink3">
          No saved payout destinations for this scope.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-line bg-card px-5">
      {items.map((b) => (
        <BeneficiaryRow key={b.id} beneficiary={b} />
      ))}
    </div>
  )
}
