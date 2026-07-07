"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { AssetLogo } from "@/components/ui/asset-logo"
import type { DiscoveredCardProps } from "@/types/components"

/** The up-arrow-into-tray glyph on the "Newly discovered" card header. */
function DiscoveredIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 3v5M12 3l-3 3M12 3l3 3M5 13v6h14v-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The info-toned "Newly discovered on-chain assets" card (design §6.23), WIRED to the real
 * discovered read — assets the Blockradar sync found that are NOT yet in the static catalog
 * (auto-enabled in the money-path overlay). Read-only review surface; loading / empty / data.
 */
export function DiscoveredCard({ items, loading }: DiscoveredCardProps) {
  return (
    <div className="mb-3.5 rounded-[16px] border border-[#cfe0fb] bg-sif px-5 py-4">
      <div className="mb-2.5 flex items-center gap-2 text-[13px] font-extrabold text-tif">
        <DiscoveredIcon />
        Newly discovered on-chain assets
      </div>

      {loading && (
        <div className="flex items-center gap-3.5 py-2.5" aria-busy="true">
          <Skeleton className="size-[38px] flex-none rounded-[10px]" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-48" />
          </div>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="py-2 text-[12px] text-ink2">
          No new assets discovered. Run a sync to check the Blockradar catalog
          for assets not yet in this catalog.
        </div>
      )}

      {!loading &&
        items.map((asset) => (
          <div key={asset.symbol} className="flex items-center gap-3.5 py-2.5">
            <AssetLogo
              sym={asset.symbol}
              logoUrl={asset.logoUrl}
              className="h-[38px] w-[38px] rounded-[10px] border border-[#cfe0fb] bg-white text-[11px] font-extrabold text-tif"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-ink">
                {asset.displayName} · {asset.symbol}
              </div>
              <div className="truncate font-mono text-[11px] text-ink3">
                {asset.networks.join(" · ") || "—"} · {asset.decimals} dp ·{" "}
                {asset.contractAddress ?? "native"}
              </div>
            </div>
            <span
              className={cn(
                "flex-none rounded-full px-[10px] py-[3px] text-[10.5px] font-bold",
                asset.enabled ? "bg-sok text-tok" : "bg-card2 text-ink3"
              )}
            >
              {asset.enabled ? "Live" : "Off"}
            </span>
          </div>
        ))}
    </div>
  )
}
