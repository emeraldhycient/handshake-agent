import type { InboundTextMessage } from '@handshake-agent/contracts';

import type { InboundMessage } from './ports/inbound-handler.port';

/**
 * Maps an `InboundTextMessage` (contracts layer) to an `InboundMessage`
 * (application-layer DTO).
 *
 * Pure function — no side effects, no dependencies — so it is trivially
 * testable and can be extracted to a shared helper if multiple controllers
 * ever need it.
 */
export function toInboundMessage(m: InboundTextMessage): InboundMessage {
  return {
    externalMessageId: m.externalMessageId,
    fromAddress: m.from,
    phoneNumberId: m.phoneNumberId,
    waName: m.waName,
    text: m.text,
    timestamp: m.timestamp,
    channel: 'whatsapp',
  };
}
