import { cn } from "@/lib/utils"
import { formatAmount } from "@/lib/format"
import { LEDGER_GRID } from "@/constants/transaction-detail"
import type { TxLedgerRowProps } from "@/types"

/** One double-entry ledger leg → the design's Account/Dir/Amount/Seq row. */
export function LedgerRow({ leg }: TxLedgerRowProps) {
  const dir = leg.direction === "debit" ? "DEBIT" : "CREDIT"
  return (
    <div
      className={cn(
        LEDGER_GRID,
        "items-center border-t border-line2 px-0.5 py-[9px]"
      )}
    >
      <span className="truncate font-mono text-[11.5px] text-ink2">
        {`${leg.accountType}:${leg.accountId}:${leg.currency}`}
      </span>
      <span
        className={cn(
          "text-[11px] font-extrabold",
          dir === "DEBIT" ? "text-tdn" : "text-tok"
        )}
      >
        {dir}
      </span>
      <span className="text-right font-mono text-[11.5px] font-bold tabular-nums">
        {formatAmount(leg.amount, leg.currency)}
      </span>
      {/* Seq: the per-account monotonic posting order. */}
      <span className="text-right font-mono text-[11px] text-ink3 tabular-nums">
        {leg.sequence}
      </span>
    </div>
  )
}
