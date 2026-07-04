import { sha256Hex } from '../../../core/crypto/hmac';
import {
  TERMINAL_WEBHOOK_STATUSES,
  WEBHOOK_PROVIDERS,
  deriveWebhookEventId,
} from './webhook-provider';

describe('webhook domain helpers', () => {
  describe('constants', () => {
    it('lists the three providers', () => {
      expect(WEBHOOK_PROVIDERS).toEqual([
        'blockradar',
        'flutterwave',
        'whatsapp',
      ]);
    });

    it('marks succeeded + dead as terminal', () => {
      expect(TERMINAL_WEBHOOK_STATUSES.has('succeeded')).toBe(true);
      expect(TERMINAL_WEBHOOK_STATUSES.has('dead')).toBe(true);
      expect(TERMINAL_WEBHOOK_STATUSES.has('failed')).toBe(false);
      expect(TERMINAL_WEBHOOK_STATUSES.has('received')).toBe(false);
    });
  });

  describe('deriveWebhookEventId', () => {
    const raw = '{"any":"body"}';

    it('uses blockradar data.id', () => {
      expect(
        deriveWebhookEventId('blockradar', { data: { id: 'wh_1' } }, raw),
      ).toBe('wh_1');
    });

    it('uses flutterwave data.id, coercing a number', () => {
      expect(
        deriveWebhookEventId('flutterwave', { data: { id: 42 } }, raw),
      ).toBe('42');
    });

    it('falls back to flutterwave data.flw_ref then top-level id', () => {
      expect(
        deriveWebhookEventId(
          'flutterwave',
          { data: { flw_ref: 'FLW-REF-9' } },
          raw,
        ),
      ).toBe('FLW-REF-9');
      expect(deriveWebhookEventId('flutterwave', { id: 7 }, raw)).toBe('7');
    });

    it('uses the whatsapp message id (wamid)', () => {
      const body = {
        entry: [
          {
            changes: [{ value: { messages: [{ id: 'wamid.ABC' }] } }],
          },
        ],
      };
      expect(deriveWebhookEventId('whatsapp', body, raw)).toBe('wamid.ABC');
    });

    it('uses the whatsapp status id when there is no message', () => {
      const body = {
        entry: [
          { changes: [{ value: { statuses: [{ id: 'wamid.STATUS' }] } }] },
        ],
      };
      expect(deriveWebhookEventId('whatsapp', body, raw)).toBe('wamid.STATUS');
    });

    it('falls back to sha256(rawBody) when no natural id exists', () => {
      const expected = sha256Hex(raw);
      expect(deriveWebhookEventId('blockradar', { data: {} }, raw)).toBe(
        expected,
      );
      expect(deriveWebhookEventId('whatsapp', {}, raw)).toBe(expected);
    });

    it('accepts a Buffer rawBody for the fallback', () => {
      const buf = Buffer.from(raw, 'utf8');
      expect(deriveWebhookEventId('blockradar', null, buf)).toBe(
        sha256Hex(raw),
      );
    });
  });
});
