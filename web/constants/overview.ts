import type { ChatAction } from "@/lib/schemas"

/** Hero quick-actions, in display order. `sell` is filtered by capability at render. */
export const HERO_ACTIONS: {
  action: ChatAction
  label: string
  primary: boolean
}[] = [
  { action: "buy", label: "Buy", primary: true },
  { action: "send", label: "Send", primary: false },
  { action: "receive", label: "Receive", primary: false },
  { action: "sell", label: "Sell", primary: false },
]
