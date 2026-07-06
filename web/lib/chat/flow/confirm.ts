/**
 * ConfirmPayload builders — from live agent quotes/swaps and from the static
 * mock fixtures. No side effects; the store calls these on demand.
 */
import type { ConfirmPayload, QuoteView, SwapView } from "@/lib/schemas"
import {
  RATE,
  PAY_NGN_50K,
  SWAP_RECEIVE_NGN,
  SEND_AMOUNT_USDT,
  SWAP_AMOUNT_USDT,
  SEND_NETWORK_FEE,
} from "./constants"

/**
 * Exhaustive dispatcher — maps the three quote-producing actions to their
 * confirm payloads. Throws (and narrows to `never`) for any non-quote action.
 */
export function buildConfirmForQuote(
  action: "buy" | "send" | "swap"
): ConfirmPayload {
  switch (action) {
    case "buy":
      return buildBuyConfirm()
    case "send":
      return buildSendConfirm()
    case "swap":
      return buildSwapConfirm()
    default: {
      const _x: never = action
      throw new Error(`buildConfirmForQuote: no builder for "${_x}"`)
    }
  }
}

/**
 * Builds a ConfirmPayload from a LIVE quote message (agent flow) so the confirm
 * sheet shows the real itemized breakdown. Used for buy / sell / send proposals.
 */
export function buildConfirmFromQuote(quote: QuoteView): ConfirmPayload {
  const action = quote.action
  const title =
    action === "sell"
      ? "Confirm sale"
      : action === "send"
        ? "Confirm transfer"
        : "Confirm purchase"
  const subtitle =
    action === "send"
      ? "Sending crypto is irreversible. Confirm the address."
      : "Check every detail — this can't be undone."

  // For send the agent puts the destination address in the first row ("To").
  const toRow =
    action === "send" ? quote.rows.find((r) => r.label === "To") : undefined

  return {
    title,
    subtitle,
    heroLabel: quote.receiveSub,
    heroAmount: quote.receiveAmt,
    heroSub: "",
    ...(toRow ? { toLabel: "To", toValue: toRow.value } : {}),
    ...(action === "send"
      ? {
          warn: "First time sending to this address? Double-check it — on-chain transfers cannot be reversed.",
        }
      : {}),
    rows: quote.rows,
    totalLabel: quote.totalLabel,
    totalValue: quote.totalValue,
    cta: "Confirm with PIN",
    action,
  }
}

export function buildBuyConfirm(): ConfirmPayload {
  return {
    title: "Confirm purchase",
    subtitle: "Check every detail — this can't be undone.",
    heroLabel: "You receive",
    heroAmount: "29.97 USDT",
    heroSub: "into your Handshake USDT wallet",
    rows: [
      { label: "You pay (debited from bank)", value: PAY_NGN_50K },
      { label: "Exchange rate", value: RATE },
      { label: "Processing fee", value: "₦250.00" },
      { label: "Network fee · USDT on TRON", value: "₦150.00" },
    ],
    totalLabel: "Total to pay",
    totalValue: PAY_NGN_50K,
    cta: "Confirm with PIN",
    action: "buy",
  }
}

export function buildSendConfirm(): ConfirmPayload {
  return {
    title: "Confirm transfer",
    subtitle: "Sending crypto is irreversible. Confirm the address.",
    heroLabel: "You send",
    heroAmount: SEND_AMOUNT_USDT,
    heroSub: "≈ ₦41,000 · on TRON",
    toLabel: "To address",
    toValue: "TQn9Y2khEb7g5mZ8FjpRt1cWnH4d3pVgk7r",
    warn: "First time sending to this address. Make sure it exactly matches your recipient — funds cannot be recovered.",
    rows: [
      { label: "Amount", value: SEND_AMOUNT_USDT },
      { label: "Network fee", value: SEND_NETWORK_FEE },
    ],
    totalLabel: "Total debited",
    totalValue: "26.00 USDT",
    cta: "Confirm with PIN",
    action: "send",
  }
}

export function buildSwapConfirm(): ConfirmPayload {
  return {
    title: "Confirm swap",
    subtitle: "Review the conversion before you confirm.",
    heroLabel: "You receive",
    heroAmount: SWAP_RECEIVE_NGN,
    heroSub: "into your naira balance",
    rows: [
      { label: "You swap", value: SWAP_AMOUNT_USDT },
      { label: "Exchange rate", value: RATE },
      { label: "Handshake fee", value: "₦0.00" },
    ],
    totalLabel: "You receive",
    totalValue: SWAP_RECEIVE_NGN,
    cta: "Confirm with PIN",
    action: "swap",
  }
}

/**
 * Builds a ConfirmPayload from a LIVE swap message (agent flow). FX spread is
 * never surfaced (CLAUDE.md §3.1 / execute-swap.tool.ts).
 */
export function buildConfirmFromSwap(swap: SwapView): ConfirmPayload {
  return {
    title: "Confirm swap",
    subtitle: "Review the conversion before you confirm.",
    heroLabel: "You receive",
    heroAmount: `${swap.toAmount} ${swap.toAsset}`,
    heroSub: `from ${swap.fromAmount} ${swap.fromAsset}`,
    rows: [
      { label: "You swap", value: `${swap.fromAmount} ${swap.fromAsset}` },
      {
        label: "Rate",
        value: `1 ${swap.fromAsset} = ${swap.rate} ${swap.toAsset}`,
      },
      { label: "Network fee", value: `${swap.networkFee} ${swap.fromAsset}` },
      {
        label: "Transaction fee",
        value: `${swap.transactionFee} ${swap.fromAsset}`,
      },
    ],
    totalLabel: "Total debit",
    totalValue: `${swap.fromAmount} ${swap.fromAsset}`,
    cta: "Confirm with PIN",
    action: "swap",
  }
}

export function buildTicketConfirm(
  tier: string,
  price: string,
  total: string
): ConfirmPayload {
  return {
    title: "Confirm ticket",
    subtitle: "Review your ticket before paying.",
    heroLabel: "Ticket",
    heroAmount: tier,
    heroSub: "Afrobeats Live 2026 · Sat 12 Jul, 8:00pm",
    rows: [
      { label: "Ticket price", value: price },
      { label: "Service fee", value: "₦750.00" },
      { label: "Pay from", value: "Naira balance" },
    ],
    totalLabel: "Total to pay",
    totalValue: total,
    cta: "Confirm with PIN",
    action: "ticket",
    meta: { tier, total },
  }
}
