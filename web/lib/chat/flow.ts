/**
 * Pure flow builders — the single home for all prototype copy/amount/fee literals.
 *
 * Source: docs/design/_ref/handshake-prototype.html
 *   - respBuy / respBalance / respReceive / respTicket / respSend / respSwap (lines 1101–1310)
 *   - completeBuy / completeSend / completeSwap / ticketConfirm / completeTicket (lines 1133–1328)
 *   - startChips (lines 1044–1051)
 *
 * No side effects. No onAction closures. The store calls buildXConfirm() on demand.
 */

import { balanceFixture, depositFixture } from "@/lib/api/fixtures"
import type {
  ChatAction,
  ConfirmPayload,
  ReceiptView,
  TextView,
  QuoteView,
  BalanceView,
  DepositView,
  TicketsView,
} from "@/lib/schemas"

// ─── Money-literal constants (DRY: each appears 3+ times) ────────────────────

const RATE = "₦1,640.00 / USDT"
const PAY_NGN_50K = "₦50,000.00"
const SWAP_RECEIVE_NGN = "₦16,320"
const SEND_AMOUNT_USDT = "25.00 USDT"
const SWAP_AMOUNT_USDT = "10.00 USDT"
const SEND_NETWORK_FEE = "1.00 USDT"

// ─── Internal helper ──────────────────────────────────────────────────────────

export function assistantText(text: string): TextView {
  return { kind: "text", text }
}

// ─── buildResponse ────────────────────────────────────────────────────────────

type ResponseMessage =
  | TextView
  | QuoteView
  | BalanceView
  | DepositView
  | TicketsView

export function buildResponse(action: ChatAction): {
  messages: ResponseMessage[]
} {
  switch (action) {
    case "buy":
      return {
        messages: [
          assistantText(
            "Here's your quote for ₦50,000 of USDT. The rate is locked for 60 seconds — check the full breakdown, then confirm."
          ),
          {
            kind: "quote",
            action: "buy",
            receiveAmt: "29.97 USDT",
            receiveSub: "≈ what lands in your wallet",
            rows: [
              { label: "You pay", value: PAY_NGN_50K },
              { label: "Exchange rate", value: RATE },
              { label: "Processing fee", value: "₦250.00" },
              { label: "Network fee · USDT on TRON", value: "₦150.00" },
            ],
            totalLabel: "Total to pay",
            totalValue: PAY_NGN_50K,
            lockSeconds: 60,
          } satisfies QuoteView,
        ],
      }

    case "balance":
      return {
        messages: [
          assistantText("Here's where you stand right now:"),
          balanceFixture,
        ],
      }

    case "receive":
      return {
        messages: [
          assistantText(
            "Here's your USDT deposit address on TRON. Only send USDT (TRC-20) here."
          ),
          depositFixture,
        ],
      }

    case "ticket":
      return {
        messages: [
          assistantText(
            "Found a match near you. Pick a tier and I'll prepare the payment — you can pay from your naira or USDT balance."
          ),
          {
            kind: "tickets",
            eventMeta: "Sat 12 Jul · Eko Hotel, Lagos",
            eventName: "Afrobeats Live 2026",
            options: [
              {
                tier: "Regular",
                perk: "General standing",
                price: "₦25,000",
                left: "120 left",
                total: "₦25,750",
              },
              {
                tier: "VIP",
                perk: "Lounge + fast entry",
                price: "₦75,000",
                left: "40 left",
                total: "₦76,250",
              },
              {
                tier: "Table for 4",
                perk: "Reserved · bottle service",
                price: "₦500,000",
                left: "6 left",
                total: "₦507,500",
              },
            ],
          } satisfies TicketsView,
        ],
      }

    case "send":
      return {
        messages: [
          assistantText(
            "Got it — sending 25 USDT on TRON. I don't recognise this address, so please double-check it before you confirm."
          ),
          {
            kind: "quote",
            action: "send",
            receiveAmt: SEND_AMOUNT_USDT,
            receiveSub: "≈ ₦41,000 sent",
            rows: [
              { label: "Amount", value: SEND_AMOUNT_USDT },
              { label: "Network", value: "USDT · TRON (TRC-20)" },
              { label: "Network fee", value: SEND_NETWORK_FEE },
              { label: "Handshake fee", value: "₦0.00" },
            ],
            totalLabel: "Total debited",
            totalValue: "26.00 USDT",
            lockSeconds: 60,
          } satisfies QuoteView,
        ],
      }

    case "swap":
      return {
        messages: [
          assistantText(
            "Sure — here's a swap of 10 USDT into naira at today's rate."
          ),
          {
            kind: "quote",
            action: "swap",
            receiveAmt: SWAP_RECEIVE_NGN,
            receiveSub: "≈ from 10.00 USDT",
            rows: [
              { label: "You swap", value: SWAP_AMOUNT_USDT },
              { label: "Exchange rate", value: RATE },
              { label: "Handshake fee", value: "₦0.00" },
            ],
            totalLabel: "You receive",
            totalValue: SWAP_RECEIVE_NGN,
            lockSeconds: 60,
          } satisfies QuoteView,
        ],
      }
  }
}

// ─── Confirm builders ─────────────────────────────────────────────────────────

/**
 * Exhaustive dispatcher — maps the three quote-producing actions to their
 * confirm payloads. Throws at runtime (and narrows to `never`) for any
 * action that does not produce a quote. Phase 16 reuses this instead of
 * duplicating the if/else chain.
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

// ─── Receipt builder ──────────────────────────────────────────────────────────

export function buildReceipt(
  action: ChatAction,
  meta?: Record<string, string>
): ReceiptView {
  switch (action) {
    case "buy":
      return {
        kind: "receipt",
        title: "Purchase complete",
        subtitle: "USDT credited to your wallet",
        amount: "+ 29.97 USDT",
        rows: [
          { label: "Paid", value: PAY_NGN_50K },
          { label: "Rate", value: RATE },
          { label: "Date", value: "18 Jun, 2:14pm" },
        ],
        txRef: "REF · HS-9F4C-22A1",
      }

    case "send":
      return {
        kind: "receipt",
        title: "Transfer sent",
        subtitle: "Broadcasting on TRON · confirming",
        amount: "- 26.00 USDT",
        rows: [
          { label: "To", value: "TQn9Y2…d3pVgk7r" },
          { label: "Network fee", value: SEND_NETWORK_FEE },
          { label: "Date", value: "18 Jun, 2:16pm" },
        ],
        txRef: "TX · a91f…7c0e",
      }

    case "swap":
      return {
        kind: "receipt",
        title: "Swap complete",
        subtitle: "10 USDT converted to naira",
        amount: `+ ${SWAP_RECEIVE_NGN}`,
        rows: [
          { label: "Swapped", value: SWAP_AMOUNT_USDT },
          { label: "Rate", value: RATE },
          { label: "Date", value: "18 Jun, 2:18pm" },
        ],
        txRef: "REF · HS-7B22-90C4",
      }

    case "ticket": {
      // tier and total are carried in meta from buildTicketConfirm
      const tier = meta?.tier ?? "Regular"
      const total = meta?.total ?? "₦25,750"
      return {
        kind: "receipt",
        title: "Ticket confirmed",
        subtitle: `Afrobeats Live 2026 · ${tier}`,
        amount: total,
        rows: [
          { label: "Entry code", value: "AFL-26-7741" },
          { label: "Gate", value: "Eko Hotel · Gate B" },
          { label: "Date", value: "Sat 12 Jul, 8:00pm" },
        ],
        txRef: "Saved to Wallet · tap to view QR",
      }
    }

    default:
      // receive and balance have no receipt in the prototype — fail loudly
      throw new Error(`buildReceipt: no receipt for action "${action}"`)
  }
}

// ─── Chip helpers ─────────────────────────────────────────────────────────────

const CHIP_LABELS: Record<ChatAction, string> = {
  buy: "Buy ₦50,000 of USDT",
  balance: "Check my balance",
  send: "Send 25 USDT",
  ticket: "Buy an event ticket",
  receive: "Show my deposit address",
  swap: "Swap 10 USDT to naira",
}

export function startChips(): ChatAction[] {
  return ["buy", "balance", "send", "ticket"]
}

export function chipLabel(action: ChatAction): string {
  return CHIP_LABELS[action]
}
