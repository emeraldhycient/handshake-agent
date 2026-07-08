/** Receipt builder for completed mock-flow transactions. No side effects. */
import type { ChatAction, ReceiptView } from "@/lib/schemas"
import {
  RATE,
  PAY_NGN_50K,
  SWAP_RECEIVE_NGN,
  SWAP_AMOUNT_USDT,
  SEND_NETWORK_FEE,
} from "./constants"

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
