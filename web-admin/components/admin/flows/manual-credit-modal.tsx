"use client"

/**
 * ManualCreditModal — the INPUT step of a manual wallet credit (Phase 7 WRITE).
 * Collects the asset (a select of the user's live wallet assets) + a positive amount,
 * validating the amount through the shared CryptoAmountSchema (≤ 8 d.p., positive)
 * before handing them to `onContinue`. It moves no money: the credit is engine-brokered
 * and runs only after reason → step-up → maker-checker → a SECOND admin's approval
 * (§3.1). The Continue CTA activates only for a valid, positive amount + a chosen asset.
 *
 * Built on the shared Dialog primitive (focus-trap + Esc close), mirroring ReasonModal.
 */
import { useState } from "react"

import { CryptoAmountSchema } from "@handshake-agent/contracts"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ManualCreditModalProps } from "@/types"

export function ManualCreditModal({
  open,
  onOpenChange,
  title,
  assets,
  onContinue,
}: ManualCreditModalProps) {
  const [asset, setAsset] = useState<string>(assets[0] ?? "")
  const [amount, setAmount] = useState("")

  const amountOk =
    CryptoAmountSchema.safeParse(amount).success && Number(amount) > 0
  const canContinue = asset.length > 0 && amountOk

  function submit() {
    if (!canContinue) return
    onContinue(asset, amount)
    setAmount("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[440px] max-w-[94vw] gap-0 p-6"
      >
        <div className="mb-1.5 flex items-center gap-[11px]">
          <span className="flex size-[34px] items-center justify-center rounded-[10px] bg-sif text-tif">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <DialogTitle>{title}</DialogTitle>
        </div>
        <DialogDescription className="mb-4 text-[13px] leading-normal text-ink2">
          This raises a manual-credit request for a SECOND admin to approve. No
          funds move until it is approved and settled by the engine.
        </DialogDescription>

        <label
          htmlFor="manual-credit-asset"
          className="mb-1.5 block text-xs font-semibold text-ink2"
        >
          Asset
        </label>
        <select
          id="manual-credit-asset"
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
          disabled={assets.length === 0}
          className="mb-3 w-full rounded-xl border border-line bg-field px-3.5 py-3 text-[13.5px] text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:text-ink3"
        >
          {assets.length === 0 ? (
            <option value="">No wallet assets</option>
          ) : (
            assets.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))
          )}
        </select>

        <label
          htmlFor="manual-credit-amount"
          className="mb-1.5 block text-xs font-semibold text-ink2"
        >
          Amount
        </label>
        <input
          id="manual-credit-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          aria-label="Credit amount"
          aria-invalid={amount.length > 0 && !amountOk}
          className="w-full rounded-xl border border-line bg-field px-3.5 py-3 font-mono text-[13.5px] tabular-nums text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {amount.length > 0 && !amountOk && (
          <p className="mt-1.5 text-[12px] font-semibold text-tdn">
            Enter a positive amount (up to 8 decimal places).
          </p>
        )}

        <div className="mt-[18px] flex gap-2.5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 rounded-xl border border-line px-3 py-3 text-center text-sm font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canContinue}
            className={cn(
              "flex-1 rounded-xl px-3 py-3 text-center text-sm font-bold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              canContinue
                ? "bg-btn-dark text-white"
                : "cursor-not-allowed bg-line text-ink3"
            )}
          >
            Continue
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
