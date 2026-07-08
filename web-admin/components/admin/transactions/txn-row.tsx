"use client"

import { useState, type MouseEvent } from "react"
import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/admin/status-pill"
import {
  STATUS_META,
  TYPE_ICON,
  FALLBACK_ICON,
  GRID,
} from "@/constants/transactions"
import {
  amountLines,
  displayName,
  formatCreated,
} from "@/lib/transactions/format"
import type { TxnRowProps } from "@/types/components"

/** One ledger row — keyboard-navigable, opens the detail route; idempotency-key copy. */
export function TxnRow({ txn, onOpen }: TxnRowProps) {
  const meta = STATUS_META[txn.status]
  const [copied, setCopied] = useState(false)
  const { crypto, fiat } = amountLines(txn)
  const name = displayName(txn.userEmail, txn.userId)

  function copyIdem(e: MouseEvent) {
    e.stopPropagation()
    void navigator.clipboard?.writeText(txn.idempotencyKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        "grid min-h-[50px] w-full cursor-pointer items-center gap-3 border-b border-line2 px-[18px] text-left transition-colors last:border-b-0 hover:bg-hov focus-visible:bg-hov focus-visible:outline-none",
        GRID
      )}
    >
      <div className="truncate font-mono text-[12px] font-bold text-tif">
        {txn.id}
      </div>
      <div className="flex items-center gap-[7px]">
        <span className="flex size-6 flex-none items-center justify-center rounded-[7px] bg-card2 text-ink2">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d={TYPE_ICON[txn.type] ?? FALLBACK_ICON}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="text-[12px] font-semibold capitalize">{txn.type}</span>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[12px] font-semibold text-ink">
          {name}
        </div>
        <div className="truncate font-mono text-[10.5px] text-ink3">
          {txn.userEmail ?? txn.userId}
        </div>
      </div>
      <div className="text-right tabular-nums">
        <div className="text-[12px] font-semibold text-ink">{crypto}</div>
        {fiat && <div className="text-[10.5px] text-ink3">{fiat}</div>}
      </div>
      <div>
        <StatusPill
          status={meta.status}
          label={meta.label}
          stuck={meta.stuck}
        />
      </div>
      <button
        type="button"
        onClick={copyIdem}
        aria-label="Copy idempotency key"
        className="flex min-w-0 items-center gap-1.5 truncate text-left font-mono text-[11px] text-ink3 transition-colors hover:text-ink2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="truncate">
          {copied ? "Copied" : txn.idempotencyKey}
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className="flex-none"
        >
          <path
            d="M9 9h10v10H9zM5 15V5h10"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      </button>
      <div className="text-[11.5px] text-ink2 tabular-nums">
        {formatCreated(txn.createdAt)}
      </div>
    </div>
  )
}
