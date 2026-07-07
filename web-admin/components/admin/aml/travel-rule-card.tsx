"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { useTravelRule } from "@/lib/query/hooks"
import { CardShell, InlineError } from "@/components/admin/aml/aml-shells"

/** Travel-Rule records card (design lines 14–17) — read-wired to `useTravelRule`. */
export function TravelRuleCard() {
  const query = useTravelRule()
  const count = query.data?.items.length ?? 0

  return (
    <CardShell>
      <div className="mb-2.5 text-[13px] font-extrabold text-ink">
        Travel Rule records
      </div>
      {query.isLoading ? (
        <Skeleton className="h-[36px] rounded-[10px]" />
      ) : query.isError ? (
        <InlineError
          label="Couldn't load Travel Rule records."
          onRetry={() => query.refetch()}
        />
      ) : count === 0 ? (
        <p className="text-[12px] leading-normal text-ink2">
          No qualifying transfers captured.
        </p>
      ) : (
        <p className="text-[12px] leading-normal text-ink2">
          Originator/beneficiary records attached for{" "}
          <b className="font-bold">{count}</b> qualifying{" "}
          {count === 1 ? "transfer" : "transfers"} over the reporting threshold.
        </p>
      )}
    </CardShell>
  )
}
