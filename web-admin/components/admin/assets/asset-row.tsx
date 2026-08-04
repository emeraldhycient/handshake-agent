"use client"

import { cn } from "@/lib/utils"
import { AssetLogo } from "@/components/ui/asset-logo"
import { ASSETS_GRID } from "@/constants/assets"
import type { AssetRowProps } from "@/types"

/**
 * One asset row — logo + sym/name, chain, decimals, min-max, copyable contract, and the
 * Live toggle-pill (click → maker-checker dual-control change).
 */
export function AssetRow({ asset, onCopy, onToggle }: AssetRowProps) {
  return (
    <div
      className={cn(
        "grid items-center gap-3 border-b border-line2 px-[18px] py-[13px] last:border-b-0",
        ASSETS_GRID
      )}
    >
      {/* Asset — logo (or green-chip fallback) + ticker + name */}
      <div className="flex min-w-0 items-center gap-2.5">
        <AssetLogo
          sym={asset.sym}
          logoUrl={asset.logo}
          className="h-[34px] w-[34px] rounded-[9px] bg-brand-green text-[11px] font-extrabold text-brand-amber"
        />
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-ink">{asset.sym}</div>
          <div className="truncate text-[11px] text-ink3">{asset.name}</div>
        </div>
      </div>

      {/* Chain */}
      <div className="font-mono text-[12px] text-ink2">{asset.chain}</div>

      {/* Decimals */}
      <div className="font-mono text-[12px] text-ink tabular-nums">
        {asset.dec}
      </div>

      {/* Min / max — not surfaced by the catalog read; renders "—" (design-faithful). */}
      <div className="font-mono text-[11px] text-ink2 tabular-nums">
        {asset.minmax}
      </div>

      {/* Contract — mono, click-to-copy (pure clipboard write) */}
      {asset.contract === "—" ? (
        <div className="truncate font-mono text-[11px] text-ink3">—</div>
      ) : (
        <button
          type="button"
          onClick={() => onCopy(asset)}
          aria-label={`Copy ${asset.sym} contract address`}
          className="truncate text-left font-mono text-[11px] text-ink3 transition-colors hover:text-ink2 focus-visible:text-ink2 focus-visible:outline-none"
        >
          {asset.contract}
        </button>
      )}

      {/* Live toggle-pill — click opens maker-checker (dual-control change) */}
      <div>
        <button
          type="button"
          onClick={() => onToggle(asset)}
          aria-label={`Toggle ${asset.sym} on ${asset.chain} live status`}
          className="cursor-pointer focus-visible:outline-none"
        >
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-[3px] text-[10.5px] font-bold",
              asset.live ? "bg-sok text-tok" : "bg-card2 text-ink2"
            )}
          >
            {asset.live ? "Live" : "Paused"}
          </span>
        </button>
      </div>
    </div>
  )
}
