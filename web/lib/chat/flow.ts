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

// ─── Internal helper ──────────────────────────────────────────────────────────

function text(t: string): TextView {
  return { kind: "text", text: t }
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
          text(
            "Here's your quote for ₦50,000 of USDT. The rate is locked for 60 seconds — check the full breakdown, then confirm."
          ),
          {
            kind: "quote",
            action: "buy",
            receiveAmt: "29.97 USDT",
            receiveSub: "≈ what lands in your wallet",
            rows: [
              { label: "You pay", value: "₦50,000.00" },
              { label: "Exchange rate", value: "₦1,640.00 / USDT" },
              { label: "FX spread (0.9%)", value: "₦450.00" },
              { label: "Processing fee", value: "₦250.00" },
              { label: "Network fee · USDT on TRON", value: "₦150.00" },
            ],
            totalLabel: "Total to pay",
            totalValue: "₦50,000.00",
            lockSeconds: 60,
          } satisfies QuoteView,
        ],
      }

    case "balance":
      return {
        messages: [text("Here's where you stand right now:"), balanceFixture],
      }

    case "receive":
      return {
        messages: [
          text(
            "Here's your USDT deposit address on TRON. Only send USDT (TRC-20) here."
          ),
          depositFixture,
        ],
      }

    case "ticket":
      return {
        messages: [
          text(
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
          text(
            "Got it — sending 25 USDT on TRON. I don't recognise this address, so please double-check it before you confirm."
          ),
          {
            kind: "quote",
            action: "send",
            receiveAmt: "25.00 USDT",
            receiveSub: "≈ ₦41,000 sent",
            rows: [
              { label: "Amount", value: "25.00 USDT" },
              { label: "Network", value: "USDT · TRON (TRC-20)" },
              { label: "Network fee", value: "1.00 USDT" },
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
          text("Sure — here's a swap of 10 USDT into naira at today's rate."),
          {
            kind: "quote",
            action: "swap",
            receiveAmt: "₦16,320",
            receiveSub: "≈ from 10.00 USDT",
            rows: [
              { label: "You swap", value: "10.00 USDT" },
              { label: "Exchange rate", value: "₦1,640.00 / USDT" },
              { label: "Spread (0.8%)", value: "₦80.00" },
              { label: "Handshake fee", value: "₦0.00" },
            ],
            totalLabel: "You receive",
            totalValue: "₦16,320",
            lockSeconds: 60,
          } satisfies QuoteView,
        ],
      }
  }
}

// ─── Confirm builders ─────────────────────────────────────────────────────────

export function buildBuyConfirm(): ConfirmPayload {
  return {
    title: "Confirm purchase",
    subtitle: "Check every detail — this can't be undone.",
    heroLabel: "You receive",
    heroAmount: "29.97 USDT",
    heroSub: "into your Handshake USDT wallet",
    rows: [
      { label: "You pay (debited from bank)", value: "₦50,000.00" },
      { label: "Exchange rate", value: "₦1,640.00 / USDT" },
      { label: "FX spread + fees", value: "₦850.00" },
    ],
    totalLabel: "Total to pay",
    totalValue: "₦50,000.00",
    cta: "Confirm with PIN",
    action: "buy",
  }
}

export function buildSendConfirm(): ConfirmPayload {
  return {
    title: "Confirm transfer",
    subtitle: "Sending crypto is irreversible. Confirm the address.",
    heroLabel: "You send",
    heroAmount: "25.00 USDT",
    heroSub: "≈ ₦41,000 · on TRON",
    toLabel: "To address",
    toValue: "TQn9Y2khEb7g5mZ8FjpRt1cWnH4d3pVgk7r",
    warn: "First time sending to this address. Make sure it exactly matches your recipient — funds cannot be recovered.",
    rows: [
      { label: "Amount", value: "25.00 USDT" },
      { label: "Network fee", value: "1.00 USDT" },
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
    heroAmount: "₦16,320",
    heroSub: "into your naira balance",
    rows: [
      { label: "You swap", value: "10.00 USDT" },
      { label: "Exchange rate", value: "₦1,640.00 / USDT" },
      { label: "Spread + fees", value: "₦80.00" },
    ],
    totalLabel: "You receive",
    totalValue: "₦16,320",
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
          { label: "Paid", value: "₦50,000.00" },
          { label: "Rate", value: "₦1,640.00 / USDT" },
          { label: "Date", value: "18 Jun, 2:14pm" },
        ],
        ref: "REF · HS-9F4C-22A1",
      }

    case "send":
      return {
        kind: "receipt",
        title: "Transfer sent",
        subtitle: "Broadcasting on TRON · confirming",
        amount: "- 26.00 USDT",
        rows: [
          { label: "To", value: "TQn9Y2…d3pVgk7r" },
          { label: "Network fee", value: "1.00 USDT" },
          { label: "Date", value: "18 Jun, 2:16pm" },
        ],
        ref: "TX · a91f…7c0e",
      }

    case "swap":
      return {
        kind: "receipt",
        title: "Swap complete",
        subtitle: "10 USDT converted to naira",
        amount: "+ ₦16,320",
        rows: [
          { label: "Swapped", value: "10.00 USDT" },
          { label: "Rate", value: "₦1,640.00 / USDT" },
          { label: "Date", value: "18 Jun, 2:18pm" },
        ],
        ref: "REF · HS-7B22-90C4",
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
        ref: "Saved to Wallet · tap to view QR",
      }
    }

    default:
      // receive and balance have no receipt in the prototype
      return {
        kind: "receipt",
        title: "",
        subtitle: "",
        amount: "",
        rows: [],
        ref: "",
      }
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
