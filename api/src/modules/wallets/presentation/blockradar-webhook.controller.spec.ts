/**
 * Unit tests for BlockradarWebhookController (R2 — deposit/withdraw webhook).
 *
 * Covers the ack-then-process contract:
 *   deposit.success:
 *   - valid sig + deposit.success with known address + deposited:true → settleDepositAtomic
 *     called with mapped fields (including sourceAddress extracted from senderAddress);
 *     sendText called with registry-formatted receipt (contains amount + asset displayName
 *     + network + txHash + new balance + receiptNumber).
 *   - invalid sig → 401, no settle.
 *   - unknown event (not deposit.success) → 200, no settle.
 *   - address not found in wallet repo → 200, no settle.
 *   - settleDepositAtomic returns deposited:false (idempotent) → 200, no receipt sent.
 *   - settleDepositAtomic throws → 200 (error swallowed + logged).
 *   - WhatsApp address not found → 200, settle happened, sendText NOT called.
 *
 *   withdraw.success / withdraw.failed:
 *   - valid sig + withdraw.success + reference → settleSendOnChain called with success:true + hash.
 *   - valid sig + withdraw.failed + reference → settleSendOnChain called with success:false.
 *   - missing reference → 200, settleSendOnChain NOT called.
 *   - settleSendOnChain throws → 200 (error swallowed).
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
import { BlockradarWebhookController } from './blockradar-webhook.controller';
import { hmacHex } from '../../../core/crypto/hmac';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_KEY = 'blockradar-test-api-key';
const TX_HASH =
  '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
const AMOUNT = '10.5';
const RECIPIENT_ADDRESS = 'TTestRecipientAddress12345678901234';
const SENDER_ADDRESS = 'TSenderAddress123456789012345678901';
const ASSET_SYMBOL = 'USDT';
const USER_ID = 'user-uuid-deposit-test';
const WALLET_ID = 'wallet-uuid-deposit-test';
const WA_ADDRESS = '2348012345678';
const NEW_BALANCE = '20.5'; // running balance (prior 10 + new 10.5)
const RECEIPT_NUMBER = 'HS-2026-000001';
const NETWORK = 'TRON';
const WITHDRAW_REFERENCE = 'withdraw-idempotency-key-uuid-789';
const TXN_ID = 'txn-id-withdraw-test';

// ---------------------------------------------------------------------------
// Helpers: fake raw body buffer
// ---------------------------------------------------------------------------

function makeRawBody(obj: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(obj), 'utf8');
}

function makeValidSig(body: Buffer): string {
  return hmacHex('sha512', API_KEY, body);
}

// ---------------------------------------------------------------------------
// Mock builders
// ---------------------------------------------------------------------------

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

function makeWalletRepo(
  wallet: WalletRecord | null = makeWalletRecord(),
): jest.Mocked<Pick<IWalletRepository, 'findByAddress'>> {
  return {
    findByAddress: jest.fn().mockResolvedValue(wallet),
  };
}

function makeSettlementRepo(
  result: 'deposited' | 'duplicate' | 'throw' = 'deposited',
): jest.Mocked<Pick<IDepositSettlementRepository, 'settleDepositAtomic'>> {
  if (result === 'throw') {
    return {
      settleDepositAtomic: jest
        .fn()
        .mockRejectedValue(new Error('settle boom')),
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

function makeIdentityService(
  address: string | null = WA_ADDRESS,
): jest.Mocked<Pick<IdentityService, 'findWhatsAppAddress'>> {
  return {
    findWhatsAppAddress: jest.fn().mockResolvedValue(address),
  };
}

function makeSender(): jest.Mocked<Pick<IWhatsAppSender, 'sendText'>> {
  return {
    sendText: jest.fn().mockResolvedValue({ externalMessageId: 'wamid.fake' }),
  };
}

function makeAssetRegistry(
  assetEnabled = true,
): jest.Mocked<
  Pick<AssetRegistry, 'asset' | 'network' | 'formatCrypto' | 'isAssetEnabled'>
> {
  return {
    asset: jest.fn().mockReturnValue({
      symbol: ASSET_SYMBOL,
      displayName: 'USDT',
      kind: 'crypto',
      decimals: 6,
      networks: [NETWORK],
      providers: {},
      enabled: true,
    }),
    network: jest.fn().mockReturnValue({
      id: NETWORK,
      displayName: 'TRON (TRC-20)',
      addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$',
      enabled: true,
    }),
    formatCrypto: jest
      .fn()
      .mockImplementation((_sym: string, amount: string) => `${amount} USDT`),
    // WN-2: isAssetEnabled gates unsupported token deposits
    isAssetEnabled: jest.fn().mockReturnValue(assetEnabled),
  };
}

function makeConfigService(apiKey: string = API_KEY): { get: jest.Mock } {
  return {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'BLOCKRADAR_API_KEY') return apiKey;
      return undefined;
    }),
  };
}

function makeExecutionService(
  settleSendResult: 'completed' | 'failed' | 'pending' | 'throw' = 'completed',
): jest.Mocked<Pick<ExecutionService, 'settleSendOnChain'>> {
  if (settleSendResult === 'throw') {
    return {
      settleSendOnChain: jest
        .fn()
        .mockRejectedValue(new Error('send settlement boom')),
    };
  }
  if (settleSendResult === 'failed') {
    return {
      settleSendOnChain: jest.fn().mockResolvedValue({
        transactionId: TXN_ID,
        status: 'failed',
        userId: USER_ID,
      }),
    };
  }
  if (settleSendResult === 'pending') {
    return {
      settleSendOnChain: jest.fn().mockResolvedValue({
        transactionId: TXN_ID,
        status: 'pending',
      }),
    };
  }
  return {
    settleSendOnChain: jest.fn().mockResolvedValue({
      transactionId: TXN_ID,
      status: 'completed',
      receiptNumber: RECEIPT_NUMBER,
      userId: USER_ID,
    }),
  };
}

function makeController(
  overrides: {
    wallet?: WalletRecord | null;
    settleResult?: 'deposited' | 'duplicate' | 'throw';
    settleSendResult?: 'completed' | 'failed' | 'pending' | 'throw';
    waAddress?: string | null;
    apiKey?: string;
    /** Set to false to simulate an unsupported deposited asset (WN-2). */
    assetEnabled?: boolean;
  } = {},
) {
  const walletRepo = makeWalletRepo(
    overrides.wallet !== undefined ? overrides.wallet : makeWalletRecord(),
  );
  const settlementRepo = makeSettlementRepo(
    overrides.settleResult ?? 'deposited',
  );
  const identityService = makeIdentityService(
    overrides.waAddress !== undefined ? overrides.waAddress : WA_ADDRESS,
  );
  const sender = makeSender();
  const assetRegistry = makeAssetRegistry(overrides.assetEnabled !== false);
  const config = makeConfigService(overrides.apiKey ?? API_KEY);
  const executionService = makeExecutionService(
    overrides.settleSendResult ?? 'completed',
  );

  const controller = new BlockradarWebhookController(
    config as never,
    walletRepo as unknown as IWalletRepository,
    settlementRepo,
    identityService as unknown as IdentityService,
    sender as unknown as IWhatsAppSender,
    assetRegistry as unknown as AssetRegistry,
    executionService as unknown as ExecutionService,
  );

  return {
    controller,
    walletRepo,
    settlementRepo,
    identityService,
    sender,
    assetRegistry,
    executionService,
  };
}

// ---------------------------------------------------------------------------
// Blockradar webhook body helpers
// ---------------------------------------------------------------------------

function depositSuccessBody(overrides: Record<string, unknown> = {}) {
  return {
    event: 'deposit.success',
    data: {
      hash: TX_HASH,
      amount: AMOUNT,
      recipientAddress: RECIPIENT_ADDRESS,
      senderAddress: SENDER_ADDRESS,
      asset: { symbol: ASSET_SYMBOL, network: { name: NETWORK } },
      confirmations: 20,
      status: 'confirmed',
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BlockradarWebhookController', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /webhooks/blockradar', () => {
    // ── Happy path ────────────────────────────────────────────────────────────

    it('valid sig + deposit.success → settleDepositAtomic called with mapped fields (including sourceAddress); sendText with registry-formatted receipt containing receiptNumber and running balance', async () => {
      const { controller, settlementRepo, identityService, sender } =
        makeController();

      const body = depositSuccessBody();
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });

      // settleDepositAtomic must be called with the mapped fields.
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

      // Identity lookup and sendText must happen.
      expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);

      // Receipt must contain key fields (captured via the mock).
      const sendCalls = sender.sendText.mock.calls;
      expect(sendCalls).toHaveLength(1);
      expect(sendCalls[0][0]).toBe(WA_ADDRESS);
      const sentText = sendCalls[0][1];
      expect(sentText).toContain(AMOUNT);
      expect(sentText).toContain('USDT'); // asset displayName
      expect(sentText).toContain('TRON'); // network displayName
      expect(sentText).toContain(TX_HASH.slice(0, 8)); // short hash
      expect(sentText).toContain(NEW_BALANCE); // RUNNING balance, not deposit amount
      expect(sentText).toContain(RECEIPT_NUMBER); // signed receipt number
    });

    // ── Invalid signature ─────────────────────────────────────────────────────

    it('invalid sig → returns 401, settleDepositAtomic NOT called', async () => {
      const { controller, settlementRepo } = makeController();

      const body = depositSuccessBody();
      const rawBody = makeRawBody(body);
      const badSig = 'deadbeef'.repeat(16); // wrong but right length

      await expect(
        controller.handleWebhook(body, rawBody, badSig),
      ).rejects.toMatchObject({ status: 401 });

      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
    });

    // ── Non-deposit event ─────────────────────────────────────────────────────

    it('unknown event (not deposit.success/withdraw.*) → returns 200, settleDepositAtomic NOT called', async () => {
      const { controller, settlementRepo, executionService } = makeController();

      const body = { event: 'some.other.event', data: { hash: TX_HASH } };
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
      expect(executionService.settleSendOnChain).not.toHaveBeenCalled();
    });

    // ── Unknown recipient address ─────────────────────────────────────────────

    it('unknown recipient address → returns 200, settleDepositAtomic NOT called', async () => {
      const { controller, settlementRepo } = makeController({ wallet: null });

      const body = depositSuccessBody();
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
    });

    // ── Idempotent duplicate ──────────────────────────────────────────────────

    it('settleDepositAtomic returns deposited:false (duplicate txHash) → 200, sendText NOT called', async () => {
      const { controller, sender } = makeController({
        settleResult: 'duplicate',
      });

      const body = depositSuccessBody();
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    // ── Settlement throws ─────────────────────────────────────────────────────

    it('settleDepositAtomic throws → returns 200 (error swallowed), sendText NOT called', async () => {
      const { controller, sender } = makeController({ settleResult: 'throw' });

      const body = depositSuccessBody();
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    // ── WhatsApp address not found ────────────────────────────────────────────

    it('WhatsApp address not found → settle happened, sendText NOT called', async () => {
      const { controller, settlementRepo, sender } = makeController({
        waAddress: null,
      });

      const body = depositSuccessBody();
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(settlementRepo.settleDepositAtomic).toHaveBeenCalled();
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    // ── Missing required fields ───────────────────────────────────────────────

    it('missing hash/amount/recipientAddress → returns 200, no settle', async () => {
      const { controller, settlementRepo } = makeController();

      // Missing recipientAddress
      const body = {
        event: 'deposit.success',
        data: { hash: TX_HASH, amount: AMOUNT },
      };
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
    });

    // ── WN-2: asset from webhook payload — correct asset credited (not wallet field) ──

    it('WN-2: deposit.success with supported USDT → settleDepositAtomic called with payload asset symbol', async () => {
      const { controller, settlementRepo } = makeController();

      const body = depositSuccessBody({
        asset: { symbol: 'USDT', network: { name: NETWORK } },
      });
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      await controller.handleWebhook(body, rawBody, sig);

      // Asset in settleDepositAtomic MUST come from the webhook payload, not wallet
      expect(settlementRepo.settleDepositAtomic).toHaveBeenCalledWith(
        expect.objectContaining({ asset: 'USDT' }),
      );
    });

    it('WN-2: deposit.success with a different supported asset on same address → credits payload asset', async () => {
      // Same recipient address (same network wallet), but different asset symbol
      const { controller, settlementRepo } = makeController();

      const body = depositSuccessBody({
        asset: { symbol: 'USDC', network: { name: NETWORK } },
      });
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      await controller.handleWebhook(body, rawBody, sig);

      // Asset must be the payload symbol, NOT USDT from any wallet field
      expect(settlementRepo.settleDepositAtomic).toHaveBeenCalledWith(
        expect.objectContaining({ asset: 'USDC' }),
      );
    });

    it('WN-2: unsupported asset deposit → 200 ack, NO credit, NO receipt', async () => {
      // Asset not enabled in catalog → log and ack without crediting
      const { controller, settlementRepo, sender } = makeController({
        assetEnabled: false,
      });

      const body = depositSuccessBody({
        asset: { symbol: 'UNKNOWN_TOKEN', network: { name: NETWORK } },
      });
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      // No credit
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
      // No receipt
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    // ── WN-4: deposit robustness — missing asset + network mismatch ───────────

    it('WN-4: deposit.success missing asset.symbol → 200 ack, NO credit', async () => {
      // Payload has no asset.symbol field — must ack without crediting
      const { controller, settlementRepo, sender } = makeController();

      const body = depositSuccessBody({
        asset: { network: { name: NETWORK } }, // no symbol
      });
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    it('WN-4: deposit.success with null asset → 200 ack, NO credit', async () => {
      // Payload has no asset object at all
      const { controller, settlementRepo, sender } = makeController();

      const body = depositSuccessBody({ asset: null });
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    it('WN-4: deposit.success where payload network does not match wallet.network → 200 ack, NO credit', async () => {
      // wallet.network = 'TRON' (from makeWalletRecord), payload says 'ETH'
      const { controller, settlementRepo, sender } = makeController();

      const body = depositSuccessBody({
        asset: { symbol: ASSET_SYMBOL, network: { name: 'ETH' } },
      });
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    it('WN-4: deposit.success where payload network matches wallet.network → credits normally', async () => {
      // wallet.network = 'TRON' (from makeWalletRecord), payload says 'TRON' → OK
      const { controller, settlementRepo } = makeController();

      const body = depositSuccessBody({
        asset: { symbol: ASSET_SYMBOL, network: { name: NETWORK } }, // NETWORK = 'TRON'
      });
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      await controller.handleWebhook(body, rawBody, sig);

      expect(settlementRepo.settleDepositAtomic).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // withdraw.success / withdraw.failed webhook events
  // ---------------------------------------------------------------------------

  describe('withdraw webhook events', () => {
    function withdrawBody(
      event: 'withdraw.success' | 'withdraw.failed',
      reference: string = WITHDRAW_REFERENCE,
      hash: string = TX_HASH,
    ) {
      return {
        event,
        data: {
          reference,
          hash,
          amount: '5.0',
          asset: { symbol: ASSET_SYMBOL, network: { name: NETWORK } },
        },
      };
    }

    it('withdraw.success + reference → settleSendOnChain called with success:true + onChainTxHash', async () => {
      const { controller, executionService, settlementRepo } = makeController();

      const body = withdrawBody('withdraw.success');
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleSendOnChain).toHaveBeenCalledWith({
        reference: WITHDRAW_REFERENCE,
        success: true,
        onChainTxHash: TX_HASH,
      });
      // Deposit path must NOT be triggered
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
    });

    it('withdraw.success → receipt sent on WhatsApp when completed', async () => {
      const { controller, identityService, sender } = makeController({
        settleSendResult: 'completed',
      });

      const body = withdrawBody('withdraw.success');
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      await controller.handleWebhook(body, rawBody, sig);

      expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);
      expect(sender.sendText).toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.stringContaining(RECEIPT_NUMBER),
      );
    });

    it('withdraw.failed + reference → settleSendOnChain called with success:false', async () => {
      const { controller, executionService } = makeController({
        settleSendResult: 'failed',
      });

      const body = withdrawBody('withdraw.failed');
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleSendOnChain).toHaveBeenCalledWith({
        reference: WITHDRAW_REFERENCE,
        success: false,
        onChainTxHash: undefined,
      });
    });

    it('withdraw.failed → failure notice sent on WhatsApp', async () => {
      const { controller, identityService, sender } = makeController({
        settleSendResult: 'failed',
      });

      const body = withdrawBody('withdraw.failed');
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      await controller.handleWebhook(body, rawBody, sig);

      expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);
      expect(sender.sendText).toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.stringContaining('⚠️'),
      );
    });

    it('withdraw.success missing reference → returns 200, settleSendOnChain NOT called', async () => {
      const { controller, executionService } = makeController();

      const body = {
        event: 'withdraw.success',
        data: { hash: TX_HASH }, // no reference
      };
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleSendOnChain).not.toHaveBeenCalled();
    });

    it('settleSendOnChain throws → returns 200 (error swallowed)', async () => {
      const { controller } = makeController({ settleSendResult: 'throw' });

      const body = withdrawBody('withdraw.success');
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
    });

    it('settleSendOnChain returns pending → returns 200, sendText NOT called', async () => {
      const { controller, executionService, sender } = makeController({
        settleSendResult: 'pending',
      });

      const body = withdrawBody('withdraw.success');
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleSendOnChain).toHaveBeenCalled();
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    it('invalid sig on withdraw event → returns 401, settleSendOnChain NOT called', async () => {
      const { controller, executionService } = makeController();

      const body = withdrawBody('withdraw.success');
      const rawBody = makeRawBody(body);
      const badSig = 'deadbeef'.repeat(16);

      await expect(
        controller.handleWebhook(body, rawBody, badSig),
      ).rejects.toMatchObject({ status: 401 });

      expect(executionService.settleSendOnChain).not.toHaveBeenCalled();
    });
  });
});
