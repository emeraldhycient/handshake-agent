/**
 * Unit tests for BlockradarWebhookController (R2 — deposit webhook).
 *
 * Covers the ack-then-process contract:
 *   - valid sig + deposit.success with known address + deposited:true → settleDepositAtomic
 *     called with mapped fields; sendText called with registry-formatted receipt
 *     (contains amount + asset displayName + network + txHash + new balance).
 *   - invalid sig → 401, no settle.
 *   - unknown event (not deposit.success) → 200, no settle.
 *   - address not found in wallet repo → 200, no settle.
 *   - settleDepositAtomic returns deposited:false (idempotent) → 200, no receipt sent.
 *   - settleDepositAtomic throws → 200 (error swallowed + logged).
 *   - WhatsApp address not found → 200, settle happened, sendText NOT called.
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
const ASSET_SYMBOL = 'USDT';
const USER_ID = 'user-uuid-deposit-test';
const WALLET_ID = 'wallet-uuid-deposit-test';
const WA_ADDRESS = '2348012345678';
const NEW_BALANCE = '10.5';
const NETWORK = 'TRON';

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
    asset: ASSET_SYMBOL,
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
    settleDepositAtomic: jest
      .fn()
      .mockResolvedValue({ deposited: true, newBalance: NEW_BALANCE }),
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

function makeAssetRegistry(): jest.Mocked<
  Pick<AssetRegistry, 'asset' | 'network' | 'formatCrypto'>
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

function makeController(
  overrides: {
    wallet?: WalletRecord | null;
    settleResult?: 'deposited' | 'duplicate' | 'throw';
    waAddress?: string | null;
    apiKey?: string;
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
  const assetRegistry = makeAssetRegistry();
  const config = makeConfigService(overrides.apiKey ?? API_KEY);

  const controller = new BlockradarWebhookController(
    config as never,
    walletRepo as unknown as IWalletRepository,
    settlementRepo,
    identityService as unknown as IdentityService,
    sender as unknown as IWhatsAppSender,
    assetRegistry as unknown as AssetRegistry,
  );

  return {
    controller,
    walletRepo,
    settlementRepo,
    identityService,
    sender,
    assetRegistry,
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

    it('valid sig + deposit.success → settleDepositAtomic called with mapped fields; sendText with registry-formatted receipt', async () => {
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
      expect(sentText).toContain(NEW_BALANCE); // new balance
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

    it('unknown event (not deposit.success) → returns 200, settleDepositAtomic NOT called', async () => {
      const { controller, settlementRepo } = makeController();

      const body = { event: 'transfer.success', data: { hash: TX_HASH } };
      const rawBody = makeRawBody(body);
      const sig = makeValidSig(rawBody);

      const result = await controller.handleWebhook(body, rawBody, sig);

      expect(result).toEqual({ status: 'ok' });
      expect(settlementRepo.settleDepositAtomic).not.toHaveBeenCalled();
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
  });
});
