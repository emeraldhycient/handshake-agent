"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { UserRow } from "@/components/admin/users/user-row"
import { GRID_COLS } from "@/constants/users"
import type { UsersTableProps } from "@/types"

/**
 * The 7-column directory table (Users.html lines 44/52): the select-all header row
 * plus the four async branches. Rows delegate to `UserRow`.
 */
export function UsersTable({
  rows,
  isLoading,
  isError,
  isSuccess,
  allSelected,
  selectedIds,
  onToggleSelectAll,
  onToggleSelect,
  onRetry,
  onOpen,
}: UsersTableProps) {
  return (
    <>
      {/* Header row */}
      <div
        className={cn(
          GRID_COLS,
          "border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase"
        )}
      >
        <button
          type="button"
          onClick={onToggleSelectAll}
          aria-label={allSelected ? "Deselect all" : "Select all"}
          aria-pressed={allSelected}
          className="cursor-pointer justify-self-start focus-visible:outline-none"
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-4 rounded-[5px] border-[1.5px]",
              allSelected ? "border-brand-green bg-brand-green" : "border-line"
            )}
          />
        </button>
        <div>Customer</div>
        <div>KYC</div>
        <div>Country</div>
        <div className="text-right">Balance</div>
        <div>Risk</div>
        <div>Last active</div>
      </div>

      {isLoading &&
        Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              GRID_COLS,
              "min-h-[52px] border-b border-line2 px-[18px] last:border-b-0"
            )}
            aria-busy="true"
          >
            <Skeleton className="size-4 rounded-[5px]" />
            <div className="flex items-center gap-[11px]">
              <Skeleton className="size-8 flex-none rounded-full" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-2.5 w-40" />
              </div>
            </div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-20 justify-self-end" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}

      {isError && (
        <div className="px-5 py-[52px] text-center">
          <div className="text-[14px] font-bold text-tdn">
            Couldn&apos;t load users
          </div>
          <div className="mt-1 text-[12.5px] text-ink2">
            The directory failed to load. Check your connection and try again.
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 inline-flex h-[34px] items-center rounded-[10px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Retry
          </button>
        </div>
      )}

      {isSuccess && rows.length === 0 && (
        <div className="px-5 py-[60px] text-center text-ink3">
          <div className="text-[14px] font-bold text-ink2">
            No users match these filters
          </div>
          <div className="mt-1 text-[12.5px]">
            Try clearing the risk chips or search.
          </div>
        </div>
      )}

      {isSuccess &&
        rows.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            selected={selectedIds.includes(u.id)}
            onToggleSelect={onToggleSelect}
            onOpen={onOpen}
          />
        ))}
    </>
  )
}
