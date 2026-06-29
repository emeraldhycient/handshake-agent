"use client"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { useBalances, useWalletAssets } from "@/lib/query/hooks"
import { useCapabilities } from "@/lib/query/capabilities"
import { chipLabel } from "@/lib/chat/flow"
import type { WalletTabProps } from "@/types/components"
import type { ChatAction } from "@/lib/schemas"

const QUICK_ACTIONS: { action: ChatAction; glyph: string; label: string }[] = [
  { action: "buy", glyph: "+", label: "Buy" },
  { action: "send", glyph: "↗", label: "Send" },
  { action: "receive", glyph: "↓", label: "Receive" },
  { action: "swap", glyph: "⇄", label: "Swap" },
]

export function WalletTab({ onQuickAction }: WalletTabProps) {
  const balancesQuery = useBalances()
  const assetsQuery = useWalletAssets()
  const { canSwap } = useCapabilities()
  // Swap is hidden until the crypto.swap capability is enabled in /config.
  const actions = canSwap
    ? QUICK_ACTIONS
    : QUICK_ACTIONS.filter((a) => a.action !== "swap")

  if (balancesQuery.isLoading || assetsQuery.isLoading) {
    return (
      <div className="flex flex-1 flex-col bg-background">
        <div className="flex-none px-5 pt-[54px] pb-[18px] [background:linear-gradient(162deg,var(--primary)_0%,var(--primary-deep)_100%)]">
          <Skeleton className="h-4 w-24 bg-white/20" />
          <Skeleton className="mt-2 h-9 w-40 bg-white/20" />
          <Skeleton className="mt-2 h-4 w-32 bg-white/20" />
          <div className="mt-[18px] flex gap-[9px]">
            {QUICK_ACTIONS.map((a) => (
              <Skeleton
                key={a.action}
                className="h-[68px] flex-1 rounded-[14px] bg-white/20"
              />
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <Skeleton className="mb-2.5 h-3 w-16 bg-muted" />
          <div className="overflow-hidden rounded-[18px] border border-border bg-card">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-t border-border px-[15px] py-[14px] first:border-t-0"
              >
                <Skeleton className="h-[38px] w-[38px] rounded-[11px]" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (balancesQuery.isError || assetsQuery.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-background p-8">
        <p className="text-sm font-semibold text-foreground">
          Could not load wallet
        </p>
        <p className="text-center text-sm text-muted-foreground">
          Check your connection and pull to refresh.
        </p>
      </div>
    )
  }

  const balances = balancesQuery.data
  const assets = assetsQuery.data ?? []

  if (!balances || assets.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-background p-8">
        <p className="text-sm font-semibold text-foreground">No assets yet</p>
        <p className="text-center text-sm text-muted-foreground">
          Fund your wallet to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex-none px-5 pt-[54px] pb-[18px] text-primary-foreground [background:linear-gradient(162deg,var(--primary)_0%,var(--primary-deep)_100%)]">
        <div className="text-[13px] font-semibold text-primary-foreground/70">
          Total balance
        </div>
        <div className="mt-0.5 text-[34px] font-extrabold tracking-[-0.02em] tabular-nums">
          {balances.total}
        </div>
        <div className="mt-[18px] flex gap-[9px]">
          {actions.map(({ action, glyph, label }) => (
            <button
              key={action}
              type="button"
              aria-label={label}
              onClick={() => onQuickAction(action, chipLabel(action))}
              className={cn(
                "flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-[14px]",
                "border border-white/15 bg-white/8 py-[11px]",
                "font-[inherit] text-primary-foreground"
              )}
            >
              <span
                className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-accent text-[17px] font-bold text-accent-foreground"
                aria-hidden="true"
              >
                {glyph}
              </span>
              <span className="text-[12px] font-semibold">{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-2.5 ml-1 text-[12px] font-bold tracking-[0.05em] text-muted-foreground uppercase">
          Assets
        </div>
        <div className="overflow-hidden rounded-[18px] border border-border bg-card">
          {assets.map((asset, i) => (
            <div
              key={asset.sym}
              className={cn(
                "flex items-center gap-3 px-[15px] py-[14px]",
                i > 0 && "border-t border-border"
              )}
            >
              <div
                className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] text-[15px] font-extrabold text-primary-deep"
                style={{ backgroundColor: asset.tint }}
                aria-hidden="true"
              >
                {asset.sym}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-bold text-foreground">
                  {asset.name}
                </div>
                <div className="text-[12.5px] text-muted-foreground tabular-nums">
                  {asset.amount}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[14.5px] font-bold text-foreground tabular-nums">
                  {asset.value}
                </div>
                <div className="text-[12px] text-success">{asset.change}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
