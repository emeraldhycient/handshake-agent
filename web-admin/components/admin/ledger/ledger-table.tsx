import { FilterSelect } from "@/components/admin/filter-select"
import { TableFilterBar } from "@/components/admin/table-filter-bar"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ACCOUNT_OPTIONS,
  CURRENCY_OPTIONS,
  FILTER_SELECT_CLASS,
  LEDGER_GRID,
} from "@/constants/ledger"
import type { LedgerTableProps } from "@/types/components"

import { LedgerRowLine } from "./ledger-row"

/**
 * The ledger table card — the filter strip (account type · currency · export) lives in
 * its header, then the six-column table with its four async branches (§5). Read-only.
 */
export function LedgerTable({
  account,
  currency,
  onAccount,
  onCurrency,
  exporting,
  onExport,
  isLoading,
  isError,
  rows,
  onRetry,
}: LedgerTableProps) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      <TableFilterBar className="grid grid-cols-3">
        <FilterSelect
          label="Filter by account type"
          value={account}
          onChange={(e) => onAccount(e.target.value)}
          options={ACCOUNT_OPTIONS}
          className={FILTER_SELECT_CLASS}
        />
        <FilterSelect
          label="Filter by currency"
          value={currency}
          onChange={(e) => onCurrency(e.target.value)}
          options={CURRENCY_OPTIONS}
          className={FILTER_SELECT_CLASS}
        />
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="flex h-[38px] w-full items-center justify-center gap-[7px] rounded-[11px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
        >
          {exporting ? "Exporting…" : "Export"}
        </button>
      </TableFilterBar>

      {/* Header row */}
      <div
        className={`${LEDGER_GRID} border-b border-line bg-card2 py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase`}
      >
        <div>Seq</div>
        <div>Account</div>
        <div>Dir</div>
        <div className="text-right">Amount</div>
        <div className="text-right">Running</div>
        <div>Source</div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`${LEDGER_GRID} items-center border-b border-line2 py-[11px] last:border-b-0`}
            >
              <Skeleton className="h-3.5 w-10" />
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3.5 w-12" />
              <Skeleton className="ml-auto h-3.5 w-16" />
              <Skeleton className="ml-auto h-3.5 w-16" />
              <Skeleton className="h-3.5 w-14" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex flex-col items-center gap-2.5 px-[18px] py-[50px] text-center">
          <p className="text-[13px] font-bold text-tdn">
            Couldn&apos;t load ledger entries
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="flex h-[34px] items-center rounded-[10px] border border-line bg-card px-3.5 text-[12px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && rows.length === 0 && (
        <div className="px-[18px] py-[50px] text-center text-[13px] text-ink3">
          No ledger entries match these filters.
        </div>
      )}

      {/* Data */}
      {!isLoading &&
        !isError &&
        rows.map((row) => <LedgerRowLine key={row.key} row={row} />)}
    </div>
  )
}
