"use client"

/**
 * TransactionDetailModal — shows the full detail of a single transaction.
 *
 * Receives a `transactionId`; fetches via useTransactionDetail (one-shot,
 * no polling). Renders four branches: loading / error / empty / data.
 *
 * Copy-to-clipboard on tx hash and counterparty address (§13 accessibility:
 * visible focus, aria-label on the copy button).
 */
import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/shared/status-pill"
import { useTransactionDetail } from "@/lib/query/hooks"
import type { StatusTone } from "@/lib/schemas"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransactionDetailModalProps {
  /** Transaction id to load, or null when the modal is closed. */
  transactionId: string | null
  onClose: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toneFor(status: string): StatusTone {
  if (status === "completed") return "success"
  if (status === "failed" || status === "rolled_back") return "neutral"
  return "warn"
}

const TYPE_LABEL: Record<string, string> = {
  buy: "Buy",
  sell: "Sell",
  send: "Send",
  deposit: "Deposit",
  receive: "Receive",
  swap: "Swap",
  ticket_purchase: "Ticket",
  reward: "Reward",
  refund: "Refund",
}

function labelFor(type: string): string {
  return TYPE_LABEL[type] ?? type.charAt(0).toUpperCase() + type.slice(1)
}

const titleCase = (s: string) =>
  s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")

function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-8)}` : hash
}

function shortAddress(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={cn(
        "ml-1 inline-flex h-5 w-5 flex-none items-center justify-center rounded transition-colors",
        "text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      )}
    >
      {copied ? (
        <CheckIcon className="h-3.5 w-3.5 text-success" aria-hidden="true" />
      ) : (
        <CopyIcon className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  )
}

// ─── DetailRow ────────────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  mono = false,
  copyValue,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  copyValue?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-[10px]">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "flex items-center text-right text-[12.5px] font-semibold tabular-nums",
          mono && "font-mono"
        )}
      >
        {value}
        {copyValue !== undefined && (
          <CopyButton value={copyValue} label={label} />
        )}
      </span>
    </div>
  )
}

// ─── TransactionDetailModal ───────────────────────────────────────────────────

export function TransactionDetailModal({
  transactionId,
  onClose,
}: TransactionDetailModalProps) {
  const { data, isLoading, isError } = useTransactionDetail(transactionId)

  return (
    <Dialog open={!!transactionId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-sm overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-[16px] font-extrabold">
            {data ? `${labelFor(data.type)} Detail` : "Transaction Detail"}
          </DialogTitle>
        </DialogHeader>

        {/* ── Loading ── */}
        {isLoading && (
          <div className="flex flex-col gap-2 px-5 pt-4 pb-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex justify-between py-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-28" />
              </div>
            ))}
          </div>
        )}

        {/* ── Error ── */}
        {isError && !isLoading && (
          <div className="flex flex-col items-center gap-2 px-5 pt-4 pb-5 text-center">
            <p className="text-danger text-sm font-semibold">
              Could not load transaction
            </p>
            <p className="text-xs text-muted-foreground">
              Please try again later.
            </p>
          </div>
        )}

        {/* ── Data ── */}
        {!isLoading && !isError && data && (
          <div className="divide-y divide-border px-5 pt-2 pb-5">
            {/* Status header */}
            <div className="flex items-center justify-between pb-3">
              <StatusPill tone={toneFor(data.status)}>
                {titleCase(data.status)}
              </StatusPill>
              {data.direction && (
                <span className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
                  {data.direction === "in" ? "Inbound" : "Outbound"}
                </span>
              )}
            </div>

            {/* Core amounts */}
            <div className="divide-y divide-border/60">
              {data.cryptoAmount && data.asset && (
                <DetailRow
                  label="Amount"
                  value={`${data.cryptoAmount} ${data.asset}`}
                />
              )}
              {data.fiatAmount && data.fiatCurrency && (
                <DetailRow
                  label={data.type === "buy" ? "You paid" : "Fiat value"}
                  value={`${data.fiatCurrency} ${data.fiatAmount}`}
                />
              )}
              {data.fees && <DetailRow label="Network fee" value={data.fees} />}

              {/* Network */}
              {data.network && (
                <DetailRow label="Network" value={data.network.toUpperCase()} />
              )}

              {/* Counterparty address */}
              {data.counterparty && (
                <DetailRow
                  label={data.direction === "in" ? "From" : "To"}
                  value={
                    <span className="font-mono">
                      {shortAddress(data.counterparty)}
                    </span>
                  }
                  copyValue={data.counterparty}
                />
              )}

              {/* On-chain tx hash */}
              {data.txHash && (
                <DetailRow
                  label="Tx hash"
                  value={
                    <span className="font-mono">{shortHash(data.txHash)}</span>
                  }
                  copyValue={data.txHash}
                />
              )}

              {/* Confirmations */}
              {data.blockNumber !== undefined && (
                <DetailRow
                  label="Block"
                  value={`#${data.blockNumber.toLocaleString()}`}
                />
              )}
              {data.confirmations !== undefined && (
                <DetailRow
                  label="Confirmations"
                  value={String(data.confirmations)}
                />
              )}

              {/* Bank payment details (buy) */}
              {data.payment && (
                <>
                  <DetailRow label="Bank" value={data.payment.bankName} />
                  <DetailRow
                    label="Account"
                    value={data.payment.accountNumber}
                    mono
                    copyValue={data.payment.accountNumber}
                  />
                  <DetailRow
                    label="Reference"
                    value={data.payment.providerRef}
                    mono
                    copyValue={data.payment.providerRef}
                  />
                </>
              )}

              {/* Receipt number */}
              {data.receiptNumber && (
                <DetailRow
                  label="Receipt"
                  value={data.receiptNumber}
                  mono
                  copyValue={data.receiptNumber}
                />
              )}

              {/* Timestamp */}
              <DetailRow label="Date" value={formatDate(data.createdAt)} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
