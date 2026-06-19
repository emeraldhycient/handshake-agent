"use client"

import { AssetIcon } from "@/components/shared/asset-icon"
import { Money } from "@/components/shared/money"
import { QrPlaceholder } from "@/components/shared/qr-placeholder"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DEPOSIT_ADDRESS } from "@/lib/constants"
import { useWalletAssets } from "@/lib/query/hooks"
import type { ChatAction } from "@/lib/schemas"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

interface WalletPageProps {
  onQuickAction: (action: ChatAction, label: string) => void
  className?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Desktop wallet page.
 * Port of prototype lines 684–718.
 * Four async branches: loading / error / empty / data.
 */
export function WalletPage({ onQuickAction, className }: WalletPageProps) {
  const assets = useWalletAssets()

  // ── Loading state ──────────────────────────────────────────────────────────
  if (assets.isLoading) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col gap-4 overflow-y-auto p-6",
          className
        )}
      >
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-24" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-16 rounded-[11px]" />
            <Skeleton className="h-9 w-16 rounded-[11px]" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-[14px]">
          <Skeleton className="h-[140px] rounded-[16px]" />
          <Skeleton className="h-[140px] rounded-[16px]" />
          <Skeleton className="h-[140px] rounded-[16px]" />
        </div>
        <Skeleton className="h-[100px] rounded-[18px]" />
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (assets.isError) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <div className="border-danger/20 bg-danger/5 rounded-[14px] border p-5 text-center">
          <p className="text-danger text-sm font-semibold">
            Failed to load wallet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      </div>
    )
  }

  const assetData = assets.data ?? []

  // ── Empty state ────────────────────────────────────────────────────────────
  if (assetData.length === 0) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <p className="text-sm text-muted-foreground">No assets yet.</p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-4 overflow-y-auto p-6",
        className
      )}
    >
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Wallet
        </h1>
        <div className="flex gap-[9px]">
          <Button
            size="sm"
            className="rounded-[11px] bg-accent font-bold text-accent-foreground"
            onClick={() => onQuickAction("buy", "Buy ₦50,000 of USDT")}
          >
            Buy
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-[11px] font-bold"
            onClick={() => onQuickAction("send", "Send 25 USDT")}
          >
            Send
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-[11px] font-bold"
            onClick={() => onQuickAction("receive", "Show my deposit address")}
          >
            Receive
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-[11px] font-bold"
            onClick={() => onQuickAction("swap", "Swap 10 USDT to naira")}
          >
            Swap
          </Button>
        </div>
      </div>

      {/* ── Asset cards grid (3-col) ─────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-[14px]">
        {assetData.map((a) => (
          <div
            key={a.sym + a.name}
            className="rounded-[16px] border border-border bg-card p-4"
          >
            <div className="flex items-center gap-[10px]">
              <AssetIcon sym={a.sym} tint={a.tint} size="sm" />
              <div>
                <p className="text-[13.5px] font-bold text-foreground">
                  {a.name}
                </p>
                <p className="text-[11.5px] text-muted-foreground">{a.sub}</p>
              </div>
            </div>
            <Money
              value={a.value}
              as="div"
              className="mt-[13px] text-[22px] font-extrabold tracking-tight text-foreground"
            />
            <p className="mt-0.5 text-[12.5px] text-muted-foreground tabular-nums">
              {a.amount} · {a.change}
            </p>
          </div>
        ))}
      </div>

      {/* ── Deposit panel ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-[18px] rounded-[18px] border border-border bg-card px-5 py-[18px]">
        {/* QR placeholder */}
        <QrPlaceholder size={86} className="flex-none" />

        {/* Address block */}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
            USDT deposit · TRON
          </p>
          <p className="mt-1.5 font-mono text-[13px] break-all text-foreground">
            {DEPOSIT_ADDRESS}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Only send USDT (TRC-20) to this address.
          </p>
        </div>

        {/* CTA */}
        <Button
          className="flex-none rounded-[11px] bg-foreground font-bold text-background hover:opacity-90"
          onClick={() => onQuickAction("receive", "Show my deposit address")}
        >
          Show QR in chat
        </Button>
      </div>
    </div>
  )
}
