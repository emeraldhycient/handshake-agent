import { DISPLAY_LOCALE, formatFiat } from "@/lib/format"
import type { ChatAction, ConfirmPayload } from "@/lib/schemas"
import type { TransactionStatusResponse } from "@handshake-agent/contracts"

/** Success-overlay label per action (the single settlement watcher resolves the receipt). */
export const COMPLETION_SUCCESS_LABEL: Record<ChatAction, string> = {
  buy: "Purchase complete",
  sell: "Sale complete",
  send: "Transfer sent",
  swap: "Swap complete",
  ticket: "Ticket confirmed",
  receive: "Deposit address shown",
  balance: "Balance loaded",
}

/**
 * Builds the kind:"receipt" body (sans id/role) for a completed transaction.
 * Buy uses the on-chain amounts the status endpoint returns; sell/send/swap fall
 * back to the confirmed proposal amounts (`pending`) since their totals are not
 * echoed on the status payload.
 */
export function buildCompletionReceipt(
  action: ChatAction,
  pending: ConfirmPayload,
  tx: TransactionStatusResponse
) {
  const date = new Date(tx.createdAt).toLocaleString(DISPLAY_LOCALE)
  const txRef = tx.receiptNumber
    ? `REF · ${tx.receiptNumber}`
    : `TX · ${tx.id.slice(0, 8)}`

  if (action === "sell") {
    return {
      kind: "receipt" as const,
      title: "Sale complete",
      subtitle: "Funds sent to your bank account",
      amount: pending.totalValue,
      rows: [
        ...pending.rows.filter((r) => r.label !== "Rate").slice(0, 2),
        { label: "Date", value: date },
      ],
      txRef,
    }
  }

  if (action === "send") {
    return {
      kind: "receipt" as const,
      title: "Transfer sent",
      subtitle: "Your crypto is on its way",
      amount: pending.heroAmount,
      rows: [
        pending.toValue
          ? { label: "To", value: pending.toValue }
          : (pending.rows[0] ?? { label: "Sent", value: pending.heroAmount }),
        { label: "Date", value: date },
      ],
      txRef,
    }
  }

  if (action === "swap") {
    // A completed swap gets a swap receipt (its amounts aren't echoed on the
    // status payload, so they come from the confirmed proposal).
    return {
      kind: "receipt" as const,
      title: "Swap complete",
      subtitle: "Your swapped balance is ready",
      amount: pending.heroAmount,
      rows: [
        pending.rows[0] ?? { label: "Swapped", value: pending.heroAmount },
        { label: "Date", value: date },
      ],
      txRef,
    }
  }

  // buy
  return {
    kind: "receipt" as const,
    title: "Purchase complete",
    subtitle: "USDT credited to your wallet",
    amount: tx.cryptoAmount
      ? `+ ${tx.cryptoAmount} ${tx.asset ?? ""}`
      : pending.heroAmount,
    rows: [
      {
        label: "Paid",
        // Drive the symbol from the transaction's fiatCurrency — never hardcode ₦.
        value: tx.fiatAmount
          ? formatFiat(tx.fiatAmount, tx.fiatCurrency ?? "NGN")
          : pending.totalValue,
      },
      { label: "Date", value: date },
    ],
    txRef,
  }
}
