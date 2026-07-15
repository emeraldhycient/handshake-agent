/**
 * Unit tests for FlutterwaveWebhookHandler — the async processing body moved
 * off FlutterwaveWebhookController. Signature verification stays in the (thin)
 * controller; the handler operates on the persisted WebhookEvent payload.
 *
 * Policy: a settle EXCEPTION propagates (BullMQ retries + dead-letters); a
 * `pending` result acks; unhandled events ack; receipt-send is best-effort.
 */
import { Logger } from '@nestjs/common';

import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { ExecutionService } from '../../transactions/application/execution.service';
import type { IdentityService } from '../../identity/application/identity.service';
import type { IWhatsAppSender } from '../../whatsapp/application/ports/whatsapp-sender.port';
import type { WebhookEventRecord } from '../../webhooks/application/ports/webhook-event.repository.port';
import { FlutterwaveWebhookHandler } from './flutterwave-webhook.handler';

const TX_REF = 'idempotency-key-uuid-123';
const SELL_REFERENCE = 'sell-idempotency-key-uuid-456';
const USER_ID = 'user-id-abc';
const RECEIPT_NUMBER = 'HS-2026-000001';
const WA_ADDRESS = '2348012345678';
const TXN_ID = 'txn-id-xyz';
const DEFAULT_ASSET_SYMBOL = 'USDT';

function makeEvent(payload: unknown): WebhookEventRecord {
  return {
    id: 'wh-fw-1',
    provider: 'flutterwave',
    providerEventId: 'evt-fw-1',
    payload,
    headers: {},
    signature: null,
    status: 'processing',
    attempts: 1,
    lastError: null,
    receivedAt: new Date(),
    lastAttemptAt: new Date(),
    processedAt: null,
    deadAt: null,
  };
}

function makeExecution(
  buy: 'completed' | 'pending' | 'throw' = 'completed',
  sell: 'completed' | 'failed' | 'pending' | 'throw' = 'completed',
  buyAssetSymbol: string = DEFAULT_ASSET_SYMBOL,
) {
  const buyFn =
    buy === 'throw'
      ? jest.fn().mockRejectedValue(new Error('settlement boom'))
      : buy === 'pending'
        ? jest
            .fn()
            .mockResolvedValue({ transactionId: TXN_ID, status: 'pending' })
        : jest.fn().mockResolvedValue({
            transactionId: TXN_ID,
            status: 'completed',
            receiptNumber: RECEIPT_NUMBER,
            userId: USER_ID,
            assetSymbol: buyAssetSymbol,
          });
  const sellFn =
    sell === 'throw'
      ? jest.fn().mockRejectedValue(new Error('sell settlement boom'))
      : sell === 'pending'
        ? jest
            .fn()
            .mockResolvedValue({ transactionId: TXN_ID, status: 'pending' })
        : sell === 'failed'
          ? jest.fn().mockResolvedValue({
              transactionId: TXN_ID,
              status: 'failed',
              userId: USER_ID,
            })
          : jest.fn().mockResolvedValue({
              transactionId: TXN_ID,
              status: 'completed',
              receiptNumber: RECEIPT_NUMBER,
              userId: USER_ID,
            });
  return { settleBuyPayment: buyFn, settleSellPayout: sellFn };
}

function makeHandler(
  o: {
    buy?: 'completed' | 'pending' | 'throw';
    sell?: 'completed' | 'failed' | 'pending' | 'throw';
    waAddress?: string | null;
    buyAssetSymbol?: string;
  } = {},
) {
  const execution = makeExecution(
    o.buy ?? 'completed',
    o.sell ?? 'completed',
    o.buyAssetSymbol ?? DEFAULT_ASSET_SYMBOL,
  );
  const identity = {
    findWhatsAppAddress: jest
      .fn()
      .mockResolvedValue(o.waAddress !== undefined ? o.waAddress : WA_ADDRESS),
  };
  const sender = {
    sendText: jest.fn().mockResolvedValue({ externalMessageId: 'x' }),
  };
  const assetDisplayNames: Record<string, string> = {
    [DEFAULT_ASSET_SYMBOL]: 'USDT',
    USDC: 'USD Coin',
  };
  const assetRegistry = {
    asset: jest.fn().mockImplementation((symbol: string) => ({
      symbol,
      displayName: assetDisplayNames[symbol] ?? symbol,
    })),
    defaultCryptoAsset: jest.fn().mockReturnValue(DEFAULT_ASSET_SYMBOL),
  };
  const handler = new FlutterwaveWebhookHandler(
    execution as unknown as ExecutionService,
    identity as unknown as IdentityService,
    sender as unknown as IWhatsAppSender,
    assetRegistry as unknown as AssetRegistry,
  );
  return { handler, execution, identity, sender, assetRegistry };
}

describe('FlutterwaveWebhookHandler', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('provider is "flutterwave"', () => {
    expect(makeHandler().handler.provider).toBe('flutterwave');
  });

  describe('charge.completed', () => {
    const body = (over: Record<string, unknown> = {}) => ({
      event: 'charge.completed',
      data: { status: 'successful', tx_ref: TX_REF, ...over },
    });

    it('successful → settleBuyPayment + receipt', async () => {
      const { handler, execution, sender } = makeHandler();
      await handler.handle(makeEvent(body()));
      expect(execution.settleBuyPayment).toHaveBeenCalledWith({
        reference: TX_REF,
      });
      expect(sender.sendText).toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.stringContaining(RECEIPT_NUMBER),
      );
    });

    it('renders the settled asset display name, not a hardcoded literal', async () => {
      const { handler, sender } = makeHandler({ buyAssetSymbol: 'USDC' });
      await handler.handle(makeEvent(body()));
      expect(sender.sendText).toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.stringContaining('USD Coin'),
      );
      expect(sender.sendText).not.toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.stringContaining('Your USDT'),
      );
    });

    it('non-success status → no settle', async () => {
      const { handler, execution } = makeHandler();
      await handler.handle(makeEvent(body({ status: 'failed' })));
      expect(execution.settleBuyPayment).not.toHaveBeenCalled();
    });

    it('missing tx_ref → no settle', async () => {
      const { handler, execution } = makeHandler();
      await handler.handle(
        makeEvent({
          event: 'charge.completed',
          data: { status: 'successful' },
        }),
      );
      expect(execution.settleBuyPayment).not.toHaveBeenCalled();
    });

    it('pending settle → no receipt', async () => {
      const { handler, sender } = makeHandler({ buy: 'pending' });
      await handler.handle(makeEvent(body()));
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    it('settle THROWS → handler re-throws (retry + dead-letter)', async () => {
      const { handler } = makeHandler({ buy: 'throw' });
      await expect(handler.handle(makeEvent(body()))).rejects.toThrow(
        'settlement boom',
      );
    });

    it('WA not found → settle happened, no send', async () => {
      const { handler, execution, sender } = makeHandler({ waAddress: null });
      await handler.handle(makeEvent(body()));
      expect(execution.settleBuyPayment).toHaveBeenCalled();
      expect(sender.sendText).not.toHaveBeenCalled();
    });
  });

  describe('transfer.completed', () => {
    const body = (
      status: string,
      reference: string | undefined = SELL_REFERENCE,
    ) => ({
      event: 'transfer.completed',
      data: { status, reference },
    });

    it('SUCCESSFUL → settleSellPayout + receipt', async () => {
      const { handler, execution, sender } = makeHandler();
      await handler.handle(makeEvent(body('SUCCESSFUL')));
      expect(execution.settleSellPayout).toHaveBeenCalledWith({
        reference: SELL_REFERENCE,
      });
      expect(sender.sendText).toHaveBeenCalled();
    });

    it('FAILED → settleSellPayout (engine refunds internally)', async () => {
      const { handler, execution } = makeHandler({ sell: 'failed' });
      await handler.handle(makeEvent(body('FAILED')));
      expect(execution.settleSellPayout).toHaveBeenCalledWith({
        reference: SELL_REFERENCE,
      });
    });

    it('unknown status → no settle', async () => {
      const { handler, execution } = makeHandler();
      await handler.handle(makeEvent(body('WEIRD')));
      expect(execution.settleSellPayout).not.toHaveBeenCalled();
    });

    it('missing reference → no settle', async () => {
      const { handler, execution } = makeHandler();
      await handler.handle(
        makeEvent({
          event: 'transfer.completed',
          data: { status: 'SUCCESSFUL' },
        }),
      );
      expect(execution.settleSellPayout).not.toHaveBeenCalled();
    });

    it('settle THROWS → handler re-throws', async () => {
      const { handler } = makeHandler({ sell: 'throw' });
      await expect(
        handler.handle(makeEvent(body('SUCCESSFUL'))),
      ).rejects.toThrow('sell settlement boom');
    });
  });

  describe('legacy flat formats', () => {
    it('legacy collection (top-level txRef + successful) → settleBuyPayment', async () => {
      const { handler, execution } = makeHandler();
      await handler.handle(makeEvent({ txRef: TX_REF, status: 'successful' }));
      expect(execution.settleBuyPayment).toHaveBeenCalledWith({
        reference: TX_REF,
      });
    });

    it('legacy transfer (top-level reference + SUCCESSFUL) → settleSellPayout', async () => {
      const { handler, execution } = makeHandler();
      await handler.handle(
        makeEvent({ reference: SELL_REFERENCE, status: 'SUCCESSFUL' }),
      );
      expect(execution.settleSellPayout).toHaveBeenCalledWith({
        reference: SELL_REFERENCE,
      });
    });

    it('unhandled event → no settle', async () => {
      const { handler, execution } = makeHandler();
      await handler.handle(makeEvent({ event: 'foo.bar', data: {} }));
      expect(execution.settleBuyPayment).not.toHaveBeenCalled();
      expect(execution.settleSellPayout).not.toHaveBeenCalled();
    });
  });
});
