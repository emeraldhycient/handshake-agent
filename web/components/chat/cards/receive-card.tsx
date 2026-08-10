"use client"

import { useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { cn } from "@/lib/utils"
import { DepositNetworkWarning } from "@/components/shared/deposit-network-warning"
import { ChatCardShell } from "@/components/chat/cards/chat-card-shell"
import type { ReceiveCardProps } from "@/types"

/**
 * ReceiveCard — chat message card for a deposit address.
 * Mobile prototype: lines 222–253. Desktop prototype: lines 851–864.
 * Mobile shows min-deposit + credited-eta chips; desktop omits them (compact).
 * No hex literals. Real scannable QR via qrcode.react.
 *
 * Copy is wired locally (navigator.clipboard + 2s "Copied" feedback) so the
 * deposit address is always copyable on the chat surface — the primary
 * receive path — without depending on a parent passing onCopy. The optional
 * onCopy prop still fires for callers that want to react (analytics, toast).
 *
 * A canonical wrong-network warning (DepositNetworkWarning) is always rendered:
 * sending the wrong asset/network to a custodial address loses funds permanently.
 */
export function ReceiveCard({
  asset,
  network,
  address,
  minDeposit,
  creditedEta,
  density,
  onCopy,
  className,
}: ReceiveCardProps) {
  const isMobile = density === "mobile"
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    onCopy?.()
  }

  return (
    <ChatCardShell density={density} className={className}>
      {/* Header */}
      {isMobile ? (
        <>
          <p className="px-4 pt-3.5 text-[12px] font-bold tracking-widest text-muted-foreground-subtle uppercase">
            Deposit address
          </p>
          <div className="flex items-center gap-1.5 px-4 pb-3">
            <span className="text-[14px] font-bold text-foreground">
              {asset}
            </span>
            <span className="rounded-full bg-background px-[9px] py-[3px] text-[12.5px] text-muted-foreground">
              {network}
            </span>
          </div>
        </>
      ) : (
        <p className="px-[15px] pt-[13px] pb-[3px] text-[11px] font-bold tracking-widest text-muted-foreground-subtle uppercase">
          Deposit · {asset} on {network}
        </p>
      )}

      {/* QR code — real, scannable QR encoding the deposit address */}
      <div
        className={cn(
          "flex justify-center",
          isMobile ? "px-4 pb-1.5" : "px-[15px] py-1.5"
        )}
      >
        <QRCodeSVG
          data-testid="qr"
          value={address}
          size={isMobile ? 150 : 130}
          bgColor="transparent"
          fgColor="currentColor"
          className="text-foreground"
        />
      </div>

      {isMobile && (
        <p className="pb-1 text-center text-[12px] text-muted-foreground-subtle">
          Scan to deposit {asset}
        </p>
      )}

      {/* Address row */}
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-[12px] border border-border bg-card-muted",
          isMobile
            ? "mx-4 my-3 px-3 py-[11px]"
            : "mx-[15px] mt-2 mb-[11px] px-3 py-[10px]"
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 font-mono leading-[1.4] break-all text-foreground",
            isMobile ? "text-[12.5px]" : "text-[12px]"
          )}
          translate="no"
        >
          {address}
        </span>
        <button
          type="button"
          aria-label={copied ? "Address copied" : "Copy address"}
          onClick={() => void handleCopy()}
          className="flex-none cursor-pointer rounded-[9px] border-none bg-foreground px-3 py-2 text-[12px] font-semibold text-card"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Wrong-network warning — canonical, both densities. */}
      <DepositNetworkWarning
        asset={asset}
        network={network}
        className={isMobile ? "mx-4 mb-3" : "mx-[15px] mb-[15px]"}
      />

      {/* Mobile-only: min deposit + credited chips */}
      {isMobile && (
        <div className="flex gap-[9px] px-4 pb-4">
          <div className="flex-1 rounded-[11px] bg-warn-muted px-3 py-2.5">
            <p className="text-[11px] font-semibold text-warn">Min deposit</p>
            <p className="text-[13.5px] font-bold text-foreground tabular-nums">
              {minDeposit}
            </p>
          </div>
          <div className="flex-1 rounded-[11px] bg-background px-3 py-2.5">
            <p className="text-[11px] font-semibold text-muted-foreground">
              Credited
            </p>
            <p className="text-[13.5px] font-bold text-foreground">
              {creditedEta}
            </p>
          </div>
        </div>
      )}
    </ChatCardShell>
  )
}
