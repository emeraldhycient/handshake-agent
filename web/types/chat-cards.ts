/** Prop types for the chat message cards (`components/chat/cards/`). */

import type {
  BalanceView,
  DepositView,
  NeedsBeneficiaryView,
  PayInView,
  QuoteView,
  ReceiptView,
  SettlingView,
  SwapView,
  TicketOption,
  TicketsView,
  TransactionsView,
} from "@/lib/schemas"
import type { SendDestinationInput } from "@handshake-agent/contracts"
import type { Density } from "./shared"

// ─── Chat message cards (Phase 11) ────────────────────────────────────────────

/** 11.1 */
export type QuoteCardProps = QuoteView & {
  density: Density
  onConfirm: () => void
  className?: string
}

/** 11.2 */
export type BalanceCardProps = BalanceView & {
  density: Density
  className?: string
}

/** 11.3 */
export type ReceiveCardProps = DepositView & {
  density: Density
  onCopy?: () => void
  className?: string
}

/** 11.4 */
export type TicketsCardProps = TicketsView & {
  density: Density
  onSelect: (opt: TicketOption) => void
  className?: string
}

/** Transaction-history list card. */
export type TransactionsCardProps = TransactionsView & {
  density: Density
  className?: string
}

/** 11.5 */
export type ReceiptCardProps = ReceiptView & {
  density: Density
  onShare?: () => void
  className?: string
}

/**
 * "Save this recipient" — shown on a completed SEND receipt only for a raw
 * (unsaved) destination (ReceiptCard gates this on action==="send" &&
 * !beneficiaryLabel). Opens the standard add-crypto flow in a dialog.
 */
export interface SaveRecipientButtonProps {
  density: Density
  className?: string
}

// ─── Pay-in card (Phase 4) ────────────────────────────────────────────────────

/** 11.6 — Bank transfer card shown while a buy order is settling */
export type PayInCardProps = PayInView & {
  density: Density
  className?: string
}

/** Outbound-settlement card shown while a sell payout / send withdrawal is in flight */
export type SettlingCardProps = SettlingView & {
  density: Density
  className?: string
}

/** Swap confirmation card for a live swap proposal from the engine. */
export type SwapCardProps = SwapView & {
  density: Density
  onConfirm: () => void
  className?: string
}

/** Inline add/select-beneficiary card shown for a needs_beneficiary outcome */
export type NeedsBeneficiaryCardProps = NeedsBeneficiaryView & {
  density: Density
  /**
   * This card's chat-message id. Forwarded to `onResolve` so the store resumes
   * the EXACT intent this card was created for (not the mutable last-intent).
   */
  messageId?: string
  /**
   * Called with the chosen/added beneficiary id once the user resolves it; the
   * card forwards its own `messageId` as the second arg for per-card binding.
   */
  onResolve: (beneficiaryId: string, messageId?: string) => void
  /**
   * Raw send-to-address path (crypto only, offered when `allowRawSend` is
   * set): called with the user-confirmed destination once the send-mode form
   * is submitted. `messageId` mirrors `onResolve`'s per-card binding. Optional
   * because the store wiring (turning this into a re-ask with
   * `sendDestination`) lands separately — until then the card renders the
   * form but has nothing to call.
   */
  onSendRaw?: (destination: SendDestinationInput, messageId?: string) => void
  className?: string
}
