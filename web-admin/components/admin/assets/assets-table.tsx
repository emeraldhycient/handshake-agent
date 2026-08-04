"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { AssetRow } from "@/components/admin/assets/asset-row"
import { ASSETS_GRID } from "@/constants/assets"
import { assetKey } from "@/lib/assets/rows"
import type { AssetsTableProps } from "@/types"

/** The asset-catalog table: the 6-column header row + four async branches. */
export function AssetsTable({
  assets,
  isLoading,
  isError,
  isSuccess,
  onRetry,
  onCopy,
  onToggle,
}: AssetsTableProps) {
  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      <div
        className={cn(
          "grid gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
          ASSETS_GRID
        )}
      >
        <div>Asset</div>
        <div>Chain</div>
        <div>Decimals</div>
        <div>Min / max</div>
        <div>Contract</div>
        <div>Live</div>
      </div>

      {isLoading &&
        Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "grid items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0",
              ASSETS_GRID
            )}
            aria-busy="true"
          >
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-[34px] flex-none rounded-[9px]" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-2.5 w-24" />
              </div>
            </div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-6" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
        ))}

      {isError && (
        <div className="px-5 py-[52px] text-center">
          <div className="text-[14px] font-bold text-tdn">
            Couldn&apos;t load the asset catalog
          </div>
          <div className="mt-1 text-[12.5px] text-ink2">
            The catalog failed to load. Check your connection and try again.
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

      {isSuccess && assets.length === 0 && (
        <div className="px-5 py-[60px] text-center text-ink3">
          <div className="text-[14px] font-bold text-ink2">
            No assets in the catalog
          </div>
          <div className="mt-1 text-[12.5px]">
            Sync the Blockradar catalog to discover and add assets.
          </div>
        </div>
      )}

      {isSuccess &&
        assets.map((asset) => (
          <AssetRow
            key={assetKey(asset)}
            asset={asset}
            onCopy={onCopy}
            onToggle={onToggle}
          />
        ))}
    </div>
  )
}
