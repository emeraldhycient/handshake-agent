"use client"

import { useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { ActionButton } from "@/components/shared/action-button"
import { AssetIcon } from "@/components/shared/asset-icon"
import { DepositNetworkWarning } from "@/components/shared/deposit-network-warning"
import { Money } from "@/components/shared/money"
import {
  QueryErrorState,
  QueryEmptyState,
} from "@/components/shared/query-states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWalletAssets, useDepositAddress } from "@/lib/query/hooks"
import { useCapabilities } from "@/lib/query/capabilities"
import { chipLabel } from "@/lib/chat/flow"
import { cn } from "@/lib/utils"
import type { ChatAction, DepositView, WalletAsset } from "@/lib/schemas"
import type { PageWithQuickActionProps } from "@/types/components"

// ─── Action definitions ───────────────────────────────────────────────────────

const ACTIONS: { action: ChatAction; label: string; primary: boolean }[] = [
  { action: "buy", label: "Buy", primary: true },
  { action: "send", label: "Send", primary: false },
  { action: "receive", label: "Receive", primary: false },
  { action: "swap", label: "Swap", primary: false },
]

// ─── Deposit helpers (multi-asset, finding #3) ────────────────────────────────
// Pure, local to this page (the deposit data layer isn't owned here). A wallet
// asset is depositable on-chain when its sub-label carries a network token
// (e.g. "USDT · TRON"). Fiat balances (e.g. "Naira — NGN balance") have no
// on-chain network and are excluded — you can't send fiat to a chain address.

const FIAT_SUBS = /ngn balance|fiat/i

/** The network token from a WalletAsset.sub, e.g. "USDT · TRON" → "TRON". */
function assetNetwork(asset: WalletAsset): string | null {
  if (FIAT_SUBS.test(asset.sub)) return null
  // "SYM · NETWORK" → take the segment after the separator as the network.
  const parts = asset.sub.split("·").map((p) => p.trim())
  if (parts.length >= 2 && parts[1]) return parts[1]
  return null
}

/**
 * Crypto holdings shown in the deposit selector (excludes fiat — you can't send
 * fiat to a chain address). An asset whose network can't be matched to a fetched
 * address still appears, but its panel shows an honest "not available here yet"
 * note instead of a (possibly wrong) address.
 */
function depositableAssets(assets: WalletAsset[]): WalletAsset[] {
  return assets.filter((a) => !FIAT_SUBS.test(a.sub))
}

/**
 * Does the fetched deposit address belong to the selected asset's network?
 * USDT and TRX both resolve to "TRON", so both match the single TRON address —
 * we then surface that the address is SHARED rather than implying it's unique.
 */
function networkMatches(
  asset: WalletAsset,
  deposit: DepositView | undefined
): boolean {
  const net = assetNetwork(asset)
  if (!net || !deposit) return false
  // deposit.network is "TRON · TRC-20"; asset network is "TRON". Match on the
  // family token (case-insensitive substring) so "TRON" ⊆ "TRON · TRC-20".
  return deposit.network.toLowerCase().includes(net.toLowerCase())
}

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
  // Selected deposit asset (by symbol). null = default to the first depositable.
  const [selectedSym, setSelectedSym] = useState<string | null>(null)

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
        <QueryErrorState
          title="Failed to load wallet"
          description="Something went wrong loading your assets. Check your connection and try again."
          onRetry={() => void assets.refetch()}
        />
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
        <QueryEmptyState
          title="No assets yet"
          description="Fund your wallet to get started."
        />
      </div>
    )
  }

  // ── Depositable-asset selector state (finding #3) ─────────────────────────
  const depositable = depositableAssets(assetData)
  const selected =
    depositable.find((a) => a.sym === selectedSym) ?? depositable[0]
  const depositData = deposit.data
  // The fetched address belongs to `selected` iff their networks match. USDT and
  // TRX both map to TRON, so both share the single TRON address — surfaced as a
  // "shared address" note rather than implying a unique address per asset.
  const addressMatchesSelected = selected
    ? networkMatches(selected, depositData)
    : false
  const sharedWith = selected
    ? depositable.filter(
        (a) =>
          a.sym !== selected.sym &&
          assetNetwork(a) &&
          assetNetwork(a) === assetNetwork(selected)
      )
    : []
  const selectedNetwork = selected ? (assetNetwork(selected) ?? "") : ""

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
            <ActionButton
              key={action}
              label={label}
              variant={primary ? "primary" : "secondary"}
              onClick={() => onQuickAction(action, chipLabel(action))}
            />
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

      {/* ── Deposit panel (multi-asset, finding #3) ─────────────────────────── */}
      <div className="flex flex-col gap-[14px] rounded-[18px] border border-border bg-card px-5 py-[18px]">
        {/* Asset selector — segmented control over the user's depositable
            holdings. Fiat is excluded (can't receive an on-chain deposit). */}
        {depositable.length > 0 && (
          <div
            role="tablist"
            aria-label="Deposit asset"
            className="flex gap-1.5 self-start rounded-[12px] border border-border bg-muted/40 p-1"
          >
            {depositable.map((a) => {
              const isActive = selected?.sym === a.sym
              const ticker = a.sub.split("·")[0].trim()
              return (
                <button
                  key={a.sym + a.name}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`${ticker} deposit`}
                  onClick={() => setSelectedSym(a.sym)}
                  className={cn(
                    "rounded-[9px] px-3 py-1.5 text-[13px] font-bold transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    isActive
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {ticker}
                </button>
              )
            })}
          </div>
        )}

        {/* Address + QR + warning for the selected asset */}
        <div className="flex items-start gap-[18px]">
          {/* QR */}
          <div className="flex-none">
            {deposit.isLoading ? (
              <Skeleton className="size-[86px] rounded-xl" />
            ) : addressMatchesSelected && depositData ? (
              <div className="rounded-xl border border-border bg-card p-1.5">
                <QRCodeSVG
                  data-testid="qr"
                  value={depositData.address}
                  size={72}
                  bgColor="transparent"
                  fgColor="currentColor"
                  className="text-foreground"
                />
              </div>
            ) : (
              <div className="flex size-[86px] items-center justify-center rounded-xl border border-border bg-muted text-[10px] text-muted-foreground">
                —
              </div>
            )}
          </div>

          {/* Details */}
          <div className="min-w-0 flex-1">
            {deposit.isLoading ? (
              <>
                <Skeleton className="h-3 w-32" />
                <Skeleton className="mt-1.5 h-4 w-full" />
                <Skeleton className="mt-1 h-3 w-48" />
              </>
            ) : deposit.isError ? (
              <p className="text-xs font-semibold text-danger">
                Could not load your deposit address.
              </p>
            ) : selected && addressMatchesSelected && depositData ? (
              <>
                <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                  {selected.sub.split("·")[0].trim()} deposit ·{" "}
                  {depositData.network}
                </p>
                <p className="mt-1.5 font-mono text-[13px] break-all text-foreground">
                  {depositData.address}
                </p>
                {sharedWith.length > 0 && (
                  // Honest: USDT and TRX share this TRON address — say so rather
                  // than implying a unique address per asset.
                  <p className="mt-1 text-xs text-muted-foreground">
                    This address is shared with{" "}
                    <span className="font-semibold text-foreground">
                      {sharedWith
                        .map((a) => a.sub.split("·")[0].trim())
                        .join(", ")}
                    </span>{" "}
                    on {selectedNetwork} — same chain, same address.
                  </p>
                )}
                <DepositNetworkWarning
                  asset={selected.sub.split("·")[0].trim()}
                  network={depositData.network}
                  className="mt-2"
                />
              </>
            ) : (
              // The fetched address is on a different network than the selected
              // asset — showing it would risk a permanent loss of funds, so we
              // don't. Point the user to chat to provision the right address.
              <div>
                <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                  {selected
                    ? `${selected.sub.split("·")[0].trim()} deposit`
                    : "Deposit"}
                </p>
                <p className="mt-1.5 text-[13px] text-muted-foreground">
                  A deposit address for{" "}
                  {selected?.sub.split("·")[0].trim() ?? "this asset"}
                  {selectedNetwork ? ` on ${selectedNetwork}` : ""} isn&apos;t
                  available here yet — ask in chat to get one.
                </p>
              </div>
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
    </div>
  )
}
