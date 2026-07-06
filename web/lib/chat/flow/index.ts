/**
 * Pure flow builders — the single home for all prototype copy/amount/fee
 * literals. No side effects; the store calls buildXConfirm() on demand. Split by
 * concern (responses / confirm / receipt / chips); import from "@/lib/chat/flow".
 */
export { assistantText, buildResponse } from "./responses"
export {
  buildConfirmForQuote,
  buildConfirmFromQuote,
  buildBuyConfirm,
  buildSendConfirm,
  buildSwapConfirm,
  buildConfirmFromSwap,
  buildTicketConfirm,
} from "./confirm"
export { buildReceipt } from "./receipt"
export { startChips, chipLabel, actionPrompt } from "./chips"
