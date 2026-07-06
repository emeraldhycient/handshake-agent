/**
 * Offline/mock agent responses. No side effects — the store calls buildResponse()
 * on demand for the anonymous demo flow.
 */
import { balanceFixture, depositFixture } from "@/lib/api/fixtures"
import type {
  ChatAction,
  TextView,
  QuoteView,
  BalanceView,
  DepositView,
  TicketsView,
} from "@/lib/schemas"
import {
  RATE,
  PAY_NGN_50K,
  SWAP_RECEIVE_NGN,
  SEND_AMOUNT_USDT,
  SWAP_AMOUNT_USDT,
  SEND_NETWORK_FEE,
} from "./constants"

export function assistantText(text: string): TextView {
  return { kind: "text", text }
}

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

    default:
      // The mock/offline flow never produces these actions (parseIntent does
      // not emit them — e.g. 'sell' is an authenticated-only flow). Fail loudly
      // rather than silently returning nothing.
      throw new Error(`buildResponse: no mock response for action "${action}"`)
  }
}
