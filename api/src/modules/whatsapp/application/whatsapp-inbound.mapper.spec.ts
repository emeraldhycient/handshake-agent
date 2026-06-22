import type { InboundTextMessage } from '@handshake-agent/contracts';

import { toInboundMessage } from './whatsapp-inbound.mapper';

const SOURCE: InboundTextMessage = {
  externalMessageId: 'wamid.HBgL2347088639675VBIhAkZZA==',
  from: '2347088639675',
  phoneNumberId: '1248377751698132',
  waName: 'Test User',
  text: 'buy 5000 naira of usdt',
  timestamp: '1720000000',
};

describe('toInboundMessage', () => {
  it('maps all fields from InboundTextMessage to InboundMessage correctly', () => {
    const result = toInboundMessage(SOURCE);

    expect(result.externalMessageId).toBe(SOURCE.externalMessageId);
    expect(result.fromAddress).toBe(SOURCE.from);
    expect(result.phoneNumberId).toBe(SOURCE.phoneNumberId);
    expect(result.waName).toBe(SOURCE.waName);
    expect(result.text).toBe(SOURCE.text);
    expect(result.timestamp).toBe(SOURCE.timestamp);
    expect(result.channel).toBe('whatsapp');
  });

  it('maps undefined waName transparently', () => {
    const result = toInboundMessage({ ...SOURCE, waName: undefined });
    expect(result.waName).toBeUndefined();
  });
});
