import type { ChatAction } from "@/lib/schemas"

// Suggestion chips are AMOUNT-FREE open prompts (consistent with the action
// buttons' actionPrompt): a chip states the intent, the agent then asks for the
// amount — it must never assume a figure the user did not choose.
const CHIP_LABELS: Record<ChatAction, string> = {
  buy: "Buy USDT",
  sell: "Sell USDT",
  balance: "Check my balance",
  send: "Send USDT",
  ticket: "Buy an event ticket",
  receive: "Show my deposit address",
  // Finding #6: swap in this product is crypto-to-crypto only. The old "Swap 10
  // USDT to naira" was semantically a SELL. Express a real crypto→crypto swap.
  swap: "Swap USDT to TRX",
}

export function startChips(): ChatAction[] {
  return ["buy", "balance", "send", "ticket"]
}

export function chipLabel(action: ChatAction): string {
  return CHIP_LABELS[action]
}

/**
 * Amount-free open prompts for the LIVE agent path (finding #6). When an
 * authenticated user taps a hero/quick action we send an open prompt so the
 * agent asks for the amount/asset against the user's real balance, rate, and
 * limits — never a fabricated amount. Every prompt is amount-free and
 * currency-symbol-free; swap is crypto→crypto.
 */
const ACTION_PROMPTS: Record<ChatAction, string> = {
  buy: "I'd like to buy USDT",
  sell: "I'd like to sell USDT",
  send: "I'd like to send USDT",
  swap: "I'd like to swap USDT to TRX",
  balance: "What's my balance?",
  receive: "Show my deposit address",
  ticket: "I'd like to buy an event ticket",
}

export function actionPrompt(action: ChatAction): string {
  return ACTION_PROMPTS[action]
}
