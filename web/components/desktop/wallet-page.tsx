"use client"

import { QRCodeSVG } from "qrcode.react"
import { AssetIcon } from "@/components/shared/asset-icon"
import { Money } from "@/components/shared/money"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWalletAssets, useDepositAddress } from "@/lib/query/hooks"
import { useCapabilities } from "@/lib/query/capabilities"
import { chipLabel } from "@/lib/chat/flow"
import { cn } from "@/lib/utils"
import type { ChatAction } from "@/lib/schemas"
import type { PageWithQuickActionProps } from "@/types/components"

// ─── Action definitions ───────────────────────────────────────────────────────

const ACTIONS: { action: ChatAction; label: string; primary: boolean }[] = [
  { action: "buy", label: "Buy", primary: true },
  { action: "send", label: "Send", primary: false },
  { action: "receive", label: "Receive", primary: false },
  { action: "swap", label: "Swap", primary: false },
]

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Desktop wallet page.
 * Uses REAL data from /wallets/balances (per-asset amount + fiatValue).
 * Unpriced assets show "—" for fiatValue — no fake totals or placeholder 24h change.
 * Deposit panel shows a real scannable QR (qrcode.react) for the selected asset.
 * Four async branches: loading / error / empty / data.
 */
export function WalletPage({
  onQuickAction,
  className,
}: PageWithQuickActionProps) {
  const assets = useWalletAssets()
  const deposit = useDepositAddress()
  const { canSwap } = useCapabilities()

  const actions = canSwap ? ACTIONS : ACTIONS.filter((a) => a.action !== "swap")

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
            <Skeleton className="h-9 w-16 rounded-[11px]" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-[14px]">
          <Skeleton className="h-[140px] rounded-[16px]" />
          <Skeleton className="h-[140px] rounded-[16px]" />
          <Skeleton className="h-[140px] rounded-[16px]" />
        </div>
        <Skeleton className="h-[120px] rounded-[18px]" />
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (assets.isError) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <div className="rounded-[14px] border border-danger/20 bg-danger/5 p-5 text-center">
          <p className="text-sm font-semibold text-danger">
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
          {actions.map(({ action, label, primary }) => (
            <Button
              key={action}
              size="sm"
              variant={primary ? "default" : "outline"}
              aria-label={label}
              className={cn(
                "rounded-[11px] font-bold",
                primary &&
                  "bg-accent text-accent-foreground hover:bg-accent-deep"
              )}
              onClick={() => onQuickAction(action, chipLabel(action))}
            >
              {label}
            </Button>
          ))}
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
              <AssetIcon
                sym={a.sym}
                tint={a.tint}
                logoUrl={a.logoUrl}
                size="sm"
              />
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
            {/* a.amount shows the crypto balance; a.change is "—" (no 24h-change source) */}
            <p className="mt-0.5 text-[12.5px] text-muted-foreground tabular-nums">
              {a.amount}
            </p>
          </div>
        ))}
      </div>

      {/* ── Deposit panel ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-[18px] rounded-[18px] border border-border bg-card px-5 py-[18px]">
        {/* Real scannable QR — address from GET /wallets/deposit-address */}
        <div className="flex-none">
          {deposit.isLoading ? (
            <Skeleton className="size-[86px] rounded-xl" />
          ) : deposit.isError || !deposit.data ? (
            <div className="flex size-[86px] items-center justify-center rounded-xl border border-border bg-muted text-[10px] text-muted-foreground">
              —
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-1.5">
              <QRCodeSVG
                data-testid="qr"
                value={deposit.data.address}
                size={72}
                bgColor="transparent"
                fgColor="currentColor"
                className="text-foreground"
              />
            </div>
          )}
        </div>

        {/* Address block */}
        <div className="min-w-0 flex-1">
          {deposit.isLoading ? (
            <>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-1.5 h-4 w-full" />
              <Skeleton className="mt-1 h-3 w-48" />
            </>
          ) : deposit.isError || !deposit.data ? (
            <p className="text-xs font-semibold text-danger">
              Could not load your deposit address.
            </p>
          ) : (
            <>
              <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                {deposit.data.asset} deposit · {deposit.data.network}
              </p>
              <p className="mt-1.5 font-mono text-[13px] break-all text-foreground">
                {deposit.data.address}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Only send {deposit.data.asset} on {deposit.data.network} to this
                address.
              </p>
            </>
          )}
        </div>

        {/* CTA — opens chat with receive intent */}
        <Button
          className="flex-none rounded-[11px] bg-foreground font-bold text-background hover:opacity-90"
          onClick={() => onQuickAction("receive", chipLabel("receive"))}
        >
          Show QR in chat
        </Button>
      </div>
    </div>
  )
}
