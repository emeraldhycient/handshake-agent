/**
 * Unit tests for BlockradarWebhookHandler — the async processing body that
 * used to live inline in BlockradarWebhookController. Signature verification
 * now lives in the (thin) controller; the handler operates on the persisted
 * WebhookEvent payload.
 *
 * Key funds-safety change vs the old controller: a settleDepositAtomic FAILURE
 * THROWS (BullMQ retries + dead-letters) instead of returning a 503.
 */

import { Logger } from '@nestjs/common';

import type {
  IDepositSettlementRepository,
  SettleDepositAtomicInput,
} from '../application/ports/deposit-settlement.repository.port';
import type {
  IWalletRepository,
  WalletRecord,
} from '../application/ports/wallet.repository.port';
import type { IdentityService } from '../../identity/application/identity.service';
import type { IWhatsAppSender } from '../../whatsapp/application/ports/whatsapp-sender.port';
import type { AssetRegistry } from '../../../core/catalog/asset-registry';
import type { ExecutionService } from '../../transactions/application/execution.service';
import { ReceiptNotSignableError } from '../../transactions/domain/execution-errors';
import type { WebhookEventRecord } from '../../webhooks/application/ports/webhook-event.repository.port';
import { BlockradarWebhookHandler } from './blockradar-webhook.handler';

const TX_HASH =
  '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
const AMOUNT = '10.5';
const RECIPIENT_ADDRESS = 'TTestRecipientAddress12345678901234';
const SENDER_ADDRESS = 'TSenderAddress123456789012345678901';
const ASSET_SYMBOL = 'USDT';
const USER_ID = 'user-uuid-deposit-test';
const WALLET_ID = 'wallet-uuid-deposit-test';
const WA_ADDRESS = '2348012345678';
const NEW_BALANCE = '20.5';
const RECEIPT_NUMBER = 'HS-2026-000001';
const NETWORK = 'TRON';
const WITHDRAW_REFERENCE = 'withdraw-idempotency-key-uuid-789';
const TXN_ID = 'txn-id-withdraw-test';

function makeWalletRecord(): WalletRecord {
  return {
    id: WALLET_ID,
    userId: USER_ID,
    network: NETWORK,
    address: RECIPIENT_ADDRESS,
    providerReference: 'blockradar-ref-001',
    status: 'active',
  };
}

function makeEvent(payload: unknown): WebhookEventRecord {
  return {
    id: 'wh-br-1',
    provider: 'blockradar',
    providerEventId: 'evt-br-1',
    payload,
    headers: {},
    signature: 'sig',
    status: 'processing',
    attempts: 1,
    lastError: null,
    receivedAt: new Date(),
    lastAttemptAt: new Date(),
    processedAt: null,
    deadAt: null,
  };
}

function makeSettlementRepo(
  result:
    | 'deposited'
    | 'duplicate'
    | 'throw'
    | 'receipt-not-signable' = 'deposited',
): jest.Mocked<Pick<IDepositSettlementRepository, 'settleDepositAtomic'>> {
  if (result === 'throw') {
    return {
      settleDepositAtomic: jest
        .fn()
        .mockRejectedValue(new Error('settle boom')),
    };
  }
  if (result === 'receipt-not-signable') {
    return {
      settleDepositAtomic: jest
        .fn()
        .mockRejectedValue(new ReceiptNotSignableError()),
    };
  }
  if (result === 'duplicate') {
    return {
      settleDepositAtomic: jest.fn().mockResolvedValue({ deposited: false }),
    };
  }
  return {
    settleDepositAtomic: jest.fn().mockResolvedValue({
      deposited: true,
      newBalance: NEW_BALANCE,
      receiptNumber: RECEIPT_NUMBER,
    }),
  };
}

function makeExecutionService(
  settleSendResult: 'completed' | 'failed' | 'pending' | 'throw' = 'completed',
): jest.Mocked<Pick<ExecutionService, 'settleSendOnChain' | 'settleSwap'>> {
  const settleSwap = jest
    .fn()
    .mockResolvedValue({ transactionId: TXN_ID, status: 'completed' });
  if (settleSendResult === 'throw') {
    return {
      settleSendOnChain: jest
        .fn()
        .mockRejectedValue(new Error('send settlement boom')),
      settleSwap,
    };
  }
  if (settleSendResult === 'failed') {
    return {
      settleSendOnChain: jest.fn().mockResolvedValue({
        transactionId: TXN_ID,
        status: 'failed',
        userId: USER_ID,
      }),
      settleSwap,
    };
  }
  if (settleSendResult === 'pending') {
    return {
      settleSendOnChain: jest
        .fn()
        .mockResolvedValue({ transactionId: TXN_ID, status: 'pending' }),
      settleSwap,
    };
  }
  return {
    settleSendOnChain: jest.fn().mockResolvedValue({
      transactionId: TXN_ID,
      status: 'completed',
      receiptNumber: RECEIPT_NUMBER,
      userId: USER_ID,
    }),
    settleSwap,
  };
}

function makeHandler(
  overrides: {
    wallet?: WalletRecord | null;
    settleResult?: 'deposited' | 'duplicate' | 'throw' | 'receipt-not-signable';
    settleSendResult?: 'completed' | 'failed' | 'pending' | 'throw';
    waAddress?: string | null;
    assetEnabled?: boolean;
    senderThrows?: boolean;
  } = {},
) {
  const walletRepo = {
    findByAddress: jest
      .fn()
      .mockResolvedValue(
        overrides.wallet !== undefined ? overrides.wallet : makeWalletRecord(),
      ),
  };
  const settlementRepo = makeSettlementRepo(
    overrides.settleResult ?? 'deposited',
  );
  const identityService = {
    findWhatsAppAddress: jest
      .fn()
      .mockResolvedValue(
        overrides.waAddress !== undefined ? overrides.waAddress : WA_ADDRESS,
      ),
  };
  const sender = {
    sendText: jest.fn().mockResolvedValue({ externalMessageId: 'wamid.fake' }),
  };
  if (overrides.senderThrows) {
    sender.sendText.mockRejectedValue(new Error('whatsapp send boom'));
  }
  const assetRegistry = {
    asset: jest
      .fn()
      .mockReturnValue({ symbol: ASSET_SYMBOL, displayName: 'USDT' }),
    network: jest.fn().mockReturnValue({ displayName: 'TRON (TRC-20)' }),
    formatCrypto: jest
      .fn()
      .mockImplementation((_s: string, a: string) => `${a} USDT`),
    isAssetEnabled: jest.fn().mockReturnValue(overrides.assetEnabled !== false),
  };
  const executionService = makeExecutionService(
    overrides.settleSendResult ?? 'completed',
  );

  const handler = new BlockradarWebhookHandler(
    walletRepo as unknown as IWalletRepository,
    settlementRepo,
    identityService as unknown as IdentityService,
    sender as unknown as IWhatsAppSender,
    assetRegistry as unknown as AssetRegistry,
    executionService as unknown as ExecutionService,
  );
  return {
    handler,
    walletRepo,
    settlementRepo,
    identityService,
    sender,
    assetRegistry,
    executionService,
  };
}

function depositBody(overrides: Record<string, unknown> = {}) {
  return {
    event: 'deposit.success',
    data: {
      hash: TX_HASH,
      amount: AMOUNT,
      recipientAddress: RECIPIENT_ADDRESS,
      senderAddress: SENDER_ADDRESS,
      asset: { symbol: ASSET_SYMBOL, network: { name: NETWORK } },
      ...overrides,
    },
  };
}

describe('BlockradarWebhookHandler', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('provider is "blockradar"', () => {
    expect(makeHandler().handler.provider).toBe('blockradar');
  });

  describe('deposit.success', () => {
    it('settles with mapped fields + sends registry-formatted receipt', async () => {
      const { handler, settlementRepo, identityService, sender } =
        makeHandler();
      await handler.handle(makeEvent(depositBody()));

      expect(settlementRepo.settleDepositAtomic).toHaveBeenCalledWith(
        expect.objectContaining<Partial<SettleDepositAtomicInput>>({
          walletId: WALLET_ID,
          userId: USER_ID,
          cryptoAmount: AMOUNT,
          asset: ASSET_SYMBOL,
          txHash: TX_HASH,
          sourceAddress: SENDER_ADDRESS,
        }),
      );
      expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);
      expect(sender.sendText).toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.stringContaining(AMOUNT),
      );
      expect(sender.sendText).toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.stringContaining(NEW_BALANCE),
      );
      expect(sender.sendText).toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.stringContaining(RECEIPT_NUMBER),
      );
    });

    it('unknown event → no settle', async () => {
      const { handler, settlementRepo, executionService } = makeHandler();
      await handler.handle(makeEvent({ event: 'some.other', data: {} }));
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
      expect(executionService.settleSendOnChain).not.toHaveBeenCalled();
    });

    it('unknown recipient address → no settle', async () => {
      const { handler, settlementRepo } = makeHandler({ wallet: null });
      await handler.handle(makeEvent(depositBody()));
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
    });

    it('duplicate txHash (deposited:false) → no receipt', async () => {
      const { handler, sender } = makeHandler({ settleResult: 'duplicate' });
      await handler.handle(makeEvent(depositBody()));
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    it('settle THROWS → handler re-throws (BullMQ retries)', async () => {
      const { handler, sender } = makeHandler({ settleResult: 'throw' });
      await expect(handler.handle(makeEvent(depositBody()))).rejects.toThrow(
        'settle boom',
      );
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    it('settle throws ReceiptNotSignableError → handler re-throws', async () => {
      const { handler } = makeHandler({ settleResult: 'receipt-not-signable' });
      await expect(
        handler.handle(makeEvent(depositBody())),
      ).rejects.toBeInstanceOf(ReceiptNotSignableError);
    });

    it('receipt send throws AFTER settle → resolves (best-effort)', async () => {
      const { handler, settlementRepo, sender } = makeHandler({
        senderThrows: true,
      });
      await expect(
        handler.handle(makeEvent(depositBody())),
      ).resolves.toBeUndefined();
      expect(settlementRepo.settleDepositAtomic).toHaveBeenCalled();
      expect(sender.sendText).toHaveBeenCalled();
    });

    it('WA address not found → settle happened, no send', async () => {
      const { handler, settlementRepo, sender } = makeHandler({
        waAddress: null,
      });
      await handler.handle(makeEvent(depositBody()));
      expect(settlementRepo.settleDepositAtomic).toHaveBeenCalled();
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    it('missing required fields → no settle', async () => {
      const { handler, settlementRepo } = makeHandler();
      await handler.handle(
        makeEvent({ event: 'deposit.success', data: { hash: TX_HASH } }),
      );
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
    });

    it('WN-2: credits the payload asset symbol (USDC), not a default', async () => {
      const { handler, settlementRepo } = makeHandler();
      await handler.handle(
        makeEvent(
          depositBody({
            asset: { symbol: 'USDC', network: { name: NETWORK } },
          }),
        ),
      );
      expect(settlementRepo.settleDepositAtomic).toHaveBeenCalledWith(
        expect.objectContaining({ asset: 'USDC' }),
      );
    });

    it('WN-2: unsupported asset → no credit, no receipt', async () => {
      const { handler, settlementRepo, sender } = makeHandler({
        assetEnabled: false,
      });
      await handler.handle(
        makeEvent(
          depositBody({
            asset: { symbol: 'UNKNOWN', network: { name: NETWORK } },
          }),
        ),
      );
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    it('WN-4: missing asset.symbol → no credit', async () => {
      const { handler, settlementRepo } = makeHandler();
      await handler.handle(
        makeEvent(depositBody({ asset: { network: { name: NETWORK } } })),
      );
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
    });

    it('WN-4: network mismatch → no credit', async () => {
      const { handler, settlementRepo } = makeHandler();
      await handler.handle(
        makeEvent(
          depositBody({
            asset: { symbol: ASSET_SYMBOL, network: { name: 'ETH' } },
          }),
        ),
      );
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
    });
  });

  describe('withdraw + swap', () => {
    const withdrawBody = (
      event: 'withdraw.success' | 'withdraw.failed',
      reference = WITHDRAW_REFERENCE,
    ) => ({ event, data: { reference, hash: TX_HASH, amount: '5.0' } });

    it('withdraw.success → settleSendOnChain(success:true, hash)', async () => {
      const { handler, executionService } = makeHandler();
      await handler.handle(makeEvent(withdrawBody('withdraw.success')));
      expect(executionService.settleSendOnChain).toHaveBeenCalledWith({
        reference: WITHDRAW_REFERENCE,
        success: true,
        onChainTxHash: TX_HASH,
      });
    });

    it('withdraw.failed → settleSendOnChain(success:false)', async () => {
      const { handler, executionService } = makeHandler({
        settleSendResult: 'failed',
      });
      await handler.handle(makeEvent(withdrawBody('withdraw.failed')));
      expect(executionService.settleSendOnChain).toHaveBeenCalledWith({
        reference: WITHDRAW_REFERENCE,
        success: false,
        onChainTxHash: undefined,
      });
    });

    it('withdraw missing reference → no settle', async () => {
      const { handler, executionService } = makeHandler();
      await handler.handle(
        makeEvent({ event: 'withdraw.success', data: { hash: TX_HASH } }),
      );
      expect(executionService.settleSendOnChain).not.toHaveBeenCalled();
    });

    it('settleSendOnChain throws → handler re-throws (BullMQ retries + dead-letters)', async () => {
      const { handler } = makeHandler({ settleSendResult: 'throw' });
      await expect(
        handler.handle(makeEvent(withdrawBody('withdraw.success'))),
      ).rejects.toThrow('send settlement boom');
    });

    it('settleSendOnChain pending → no receipt', async () => {
      const { handler, sender } = makeHandler({ settleSendResult: 'pending' });
      await handler.handle(makeEvent(withdrawBody('withdraw.success')));
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    it('swap.success → settleSwap(success:true, toAmount, hash)', async () => {
      const { handler, executionService } = makeHandler();
      await handler.handle(
        makeEvent({
          event: 'swap.success',
          data: { reference: 'sw-1', amount: '9.9', hash: TX_HASH },
        }),
      );
      expect(executionService.settleSwap).toHaveBeenCalledWith({
        reference: 'sw-1',
        success: true,
        toAmount: '9.9',
        hash: TX_HASH,
      });
    });

    it('swap.failed → settleSwap(success:false)', async () => {
      const { handler, executionService } = makeHandler();
      await handler.handle(
        makeEvent({ event: 'swap.failed', data: { reference: 'sw-2' } }),
      );
      expect(executionService.settleSwap).toHaveBeenCalledWith({
        reference: 'sw-2',
        success: false,
        toAmount: undefined,
        hash: undefined,
      });
    });
  });
});
