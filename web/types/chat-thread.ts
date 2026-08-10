/** Prop types for the chat thread shell (`components/chat/`). */

import type { ChatAction, ChatMessage, TicketOption } from "@/lib/schemas"
import type { SendDestinationInput } from "@handshake-agent/contracts"
import type { Density } from "./shared"

// ─── Phase 12 chat thread components ──────────────────────────────────────────

/** 12.2 */
export interface ChatMessageViewProps {
  message: ChatMessage
  density: Density
  onConfirm: (m: ChatMessage) => void
  onSelectTicket: (opt: TicketOption) => void
  /**
   * Resolve a needs_beneficiary card — re-asks the sell/send with the new id.
   * `messageId` is the resolving card's id so the store resumes the EXACT intent
   * that card was bound to (not the mutable last-intent). Optional for legacy
   * callers that don't forward it.
   */
  onResolveBeneficiary: (beneficiaryId: string, messageId?: string) => void
  /**
   * Raw send-to-address resolve (crypto only, needs_beneficiary cards with
   * `allowRawSend`): forwarded to the card's `onSendRaw`. Optional — surfaces
   * that don't offer the raw-send path (or existing tests) omit it.
   */
  onSendRaw?: (destination: SendDestinationInput, messageId?: string) => void
}

/** 12.3 */
export interface ChatComposerProps {
  chips: ChatAction[]
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onChip: (a: ChatAction) => void
  density: Density
  recording: boolean
  recordSeconds: number
  canRecord: boolean
  onRecordStart: () => void
  onRecordStop: () => void
  onRecordCancel: () => void
}

/** 12.4 */
export interface ChatThreadProps {
  messages: ChatMessage[]
  typing: boolean
  density: Density
  onConfirm: (m: ChatMessage) => void
  onSelectTicket: (opt: TicketOption) => void
  /** Forwarded to each card; `messageId` binds the resume to that exact card. */
  onResolveBeneficiary: (beneficiaryId: string, messageId?: string) => void
  /** Forwarded to each card's raw send-to-address resolve — see ChatMessageViewProps. */
  onSendRaw?: (destination: SendDestinationInput, messageId?: string) => void
}
