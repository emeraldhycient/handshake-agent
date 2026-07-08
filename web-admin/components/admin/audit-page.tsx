"use client"

/**
 * AuditPage — the immutable, hash-chained audit-log viewer (design §6.10). Orchestrator:
 * pulls the filter/pagination/verify view-model from `useAuditLog` and composes the header
 * (chain-integrity pill + CSV export), the filter row, the table, and the keyset pager.
 * Read-only; every mutating action across the console lands here, never editable.
 */
import { useAuditLog } from "@/lib/hooks/use-audit-log"
import { ChainPill } from "@/components/admin/audit/chain-pill"
import { AuditFilterBar } from "@/components/admin/audit/audit-filter-bar"
import { AuditTable } from "@/components/admin/audit/audit-table"

export function AuditPage() {
  const a = useAuditLog()

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-1 flex-col overflow-y-auto px-[30px] pt-[26px] pb-[60px]">
      {/* Header: title + subtitle · hash-chain pill + Export */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Audit log
          </h1>
          <p className="mt-[5px] text-[13.5px] text-ink2">
            Immutable record of every mutating action. Never editable, nothing
            hard-deleted.
          </p>
        </div>
        <div className="flex items-center gap-[9px]">
          <ChainPill verify={a.verify} />
          <button
            type="button"
            onClick={() => void a.onExport()}
            disabled={a.exporting}
            className="flex h-[34px] cursor-pointer items-center gap-[7px] rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Export
          </button>
        </div>
      </div>

      {/* Table — filters live in its header strip */}
      <div className="overflow-hidden rounded-[16px] border border-line bg-card">
        <AuditFilterBar
          search={a.search}
          onSearchChange={a.onSearchChange}
          action={a.action}
          onActionChange={a.onActionChange}
          from={a.from}
          onFromChange={a.onFromChange}
          to={a.to}
          onToChange={a.onToChange}
        />
        <AuditTable
          items={a.items}
          isLoading={a.audit.isLoading}
          isError={a.audit.isError}
          isSuccess={a.audit.isSuccess}
          onRetry={() => a.audit.refetch()}
        />
      </div>

      {/* Keyset pagination — Previous / Next over the DTO's `nextCursor`. */}
      {a.audit.isSuccess && (a.items.length > 0 || a.cursors.length > 0) && (
        <div className="mt-[14px] flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={a.cursors.length === 0 || a.audit.isFetching}
            onClick={a.goPrev}
            className="h-[34px] rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!a.nextCursor || a.audit.isFetching}
            onClick={a.goNext}
            className="h-[34px] rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {a.audit.isFetching ? "Loading…" : "Next"}
          </button>
        </div>
      )}
    </div>
  )
}
