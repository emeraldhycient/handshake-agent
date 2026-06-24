/**
 * Port: inbound-handler
 *
 * The controller depends on this abstraction; Phase 2 binds the real
 * ConversationService. Phase 1.6 registers the binding in the module.
 *
 * `InboundMessage` is the app-layer DTO the controller builds from
 * `InboundTextMessage` (contracts). It is deliberately separate from the
 * contracts type so the application layer controls what it receives — the
 * mapping lives in `whatsapp-inbound.mapper.ts`.
 */

/** DI token for the inbound message handler. */
export const INBOUND_HANDLER = Symbol('INBOUND_HANDLER');

/**
 * App-layer inbound message DTO.
 * Maps from `InboundTextMessage` (contracts) via `toInboundMessage`.
 */
export type InboundMessage = {
  /** The WhatsApp message ID (`wamid.*`). */
  externalMessageId: string;
  /** Sender's WhatsApp phone number (E.164 without the '+' prefix). */
  fromAddress: string;
  /** The phone number ID of the receiving business account. */
  phoneNumberId: string;
  /** The sender's WhatsApp display name; undefined when Meta omits contacts. */
  waName: string | undefined;
  /** The raw text body the user sent. */
  text: string;
  /** Unix timestamp in seconds as a string. */
  timestamp: string;
  /** Fixed channel tag so consumers can route across channels. */
  channel: 'whatsapp';
};

/**
 * The application depends on this abstraction. ConversationService (Phase 2)
 * will implement it; for now the binding is left open (no-op in tests).
 */
export interface IInboundHandler {
  handleInbound(msg: InboundMessage): Promise<void>;
}
