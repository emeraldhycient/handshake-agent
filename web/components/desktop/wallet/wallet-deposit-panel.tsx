"use client"

import { useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { DepositNetworkWarning } from "@/components/shared/deposit-network-warning"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  assetNetwork,
  depositableAssets,
  networkMatches,
} from "@/lib/wallet/deposit"
import { chipLabel } from "@/lib/chat/flow"
import { cn } from "@/lib/utils"
import type { WalletDepositPanelProps } from "@/types/wallet"

/** Ticker portion of a WalletAsset.sub, e.g. "USDT · TRON" → "USDT". */
const ticker = (sub: string) => sub.split("·")[0].trim()

/**
 * Multi-asset deposit panel (finding #3). Owns the selected-asset UI state and
 * derives the depositable set + address match via the pure `lib/wallet/deposit`
 * helpers. Never shows an address on a network the selected asset isn't on
 * (that would risk a permanent loss of funds).
 */
export function WalletDepositPanel({
  assets,
  depositData,
  depositLoading,
  depositError,
  onQuickAction,
}: WalletDepositPanelProps) {
  const [selectedSym, setSelectedSym] = useState<string | null>(null)

  const depositable = depositableAssets(assets)
  const selected =
    depositable.find((a) => a.sym === selectedSym) ?? depositable[0]
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
    <div className="flex flex-col gap-[14px] rounded-[18px] border border-border bg-card px-5 py-[18px]">
      {depositable.length > 0 && (
        <div
          role="tablist"
          aria-label="Deposit asset"
          className="flex gap-1.5 self-start rounded-[12px] border border-border bg-muted/40 p-1"
        >
          {depositable.map((a) => {
            const isActive = selected?.sym === a.sym
            return (
              <button
                key={a.sym + a.name}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`${ticker(a.sub)} deposit`}
                onClick={() => setSelectedSym(a.sym)}
                className={cn(
                  "rounded-[9px] px-3 py-1.5 text-[13px] font-bold transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  isActive
                    ? "bg-card text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {ticker(a.sub)}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-start gap-x-[18px] gap-y-3">
        <div className="flex-none">
          {depositLoading ? (
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

        <div className="min-w-[190px] flex-1">
          {depositLoading ? (
            <>
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-1.5 h-4 w-full" />
              <Skeleton className="mt-1 h-3 w-48" />
            </>
          ) : depositError ? (
            <p className="text-xs font-semibold text-danger">
              Could not load your deposit address.
            </p>
          ) : selected && addressMatchesSelected && depositData ? (
            <>
              <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                {ticker(selected.sub)} deposit · {depositData.network}
              </p>
              <p className="mt-1.5 font-mono text-[13px] break-all text-foreground">
                {depositData.address}
              </p>
              {sharedWith.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  This address is shared with{" "}
                  <span className="font-semibold text-foreground">
                    {sharedWith.map((a) => ticker(a.sub)).join(", ")}
                  </span>{" "}
                  on {selectedNetwork} — same chain, same address.
                </p>
              )}
              <DepositNetworkWarning
                asset={ticker(selected.sub)}
                network={depositData.network}
                className="mt-2"
              />
            </>
          ) : (
            <div>
              <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
                {selected ? `${ticker(selected.sub)} deposit` : "Deposit"}
              </p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">
                A deposit address for{" "}
                {selected ? ticker(selected.sub) : "this asset"}
                {selectedNetwork ? ` on ${selectedNetwork}` : ""} isn&apos;t
                available here yet — ask in chat to get one.
              </p>
            </div>
          )}
        </div>

        <Button
          size="xl"
          className="ml-auto flex-none bg-foreground font-bold text-background hover:opacity-90"
          onClick={() => onQuickAction("receive", chipLabel("receive"))}
        >
          Show QR in chat
        </Button>
      </div>
    </div>
  )
}
