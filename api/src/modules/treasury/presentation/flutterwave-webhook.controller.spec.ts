/**
 * Unit tests for FlutterwaveWebhookController (Task 6.4).
 *
 * Covers the ack-then-process contract:
 *   - valid verif-hash + charge.completed + settle returns completed → receipt sent
 *   - invalid verif-hash → 401, nothing called
 *   - non-success event or missing tx_ref → 200, settleBuyPayment NOT called
 *   - settleBuyPayment returns pending → 200, no receipt
 *   - settleBuyPayment throws → 200 (error swallowed + logged)
 *   - WhatsApp address not found → 200, settle happened, no send
 */

import { Logger } from '@nestjs/common';

import type { IPaymentProvider } from '../application/ports/payment-provider.port';
import type { ExecutionService } from '../../transactions/application/execution.service';
import type { IdentityService } from '../../identity/application/identity.service';
import type { IWhatsAppSender } from '../../whatsapp/application/ports/whatsapp-sender.port';
import { FlutterwaveWebhookController } from './flutterwave-webhook.controller';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_HASH = 'my-webhook-secret';
const TX_REF = 'idempotency-key-uuid-123';
const USER_ID = 'user-id-abc';
const RECEIPT_NUMBER = 'HS-2026-000001';
const WA_ADDRESS = '2348012345678';
const TXN_ID = 'txn-id-xyz';

function makePaymentProvider(
  verifyResult = true,
): jest.Mocked<IPaymentProvider> {
  return {
    createCollection: jest.fn(),
    verify: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(verifyResult),
  };
}

function makeExecutionService(
  settleBuyResult: 'completed' | 'pending' | 'throw' = 'completed',
): jest.Mocked<Pick<ExecutionService, 'settleBuyPayment'>> {
  if (settleBuyResult === 'throw') {
    return {
      settleBuyPayment: jest
        .fn()
        .mockRejectedValue(new Error('settlement boom')),
    };
  }
  if (settleBuyResult === 'pending') {
    return {
      settleBuyPayment: jest.fn().mockResolvedValue({
        transactionId: TXN_ID,
        status: 'pending',
      }),
    };
  }
  return {
    settleBuyPayment: jest.fn().mockResolvedValue({
      transactionId: TXN_ID,
      status: 'completed',
      receiptNumber: RECEIPT_NUMBER,
      userId: USER_ID,
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

function makeController(
  overrides: {
    verifyResult?: boolean;
    settleResult?: 'completed' | 'pending' | 'throw';
    waAddress?: string | null;
  } = {},
) {
  const paymentProvider = makePaymentProvider(overrides.verifyResult ?? true);
  const executionService = makeExecutionService(
    overrides.settleResult ?? 'completed',
  );
  const identityService = makeIdentityService(
    overrides.waAddress !== undefined ? overrides.waAddress : WA_ADDRESS,
  );
  const sender = makeSender();

  const controller = new FlutterwaveWebhookController(
    paymentProvider,
    executionService as unknown as ExecutionService,
    identityService as unknown as IdentityService,
    sender as unknown as IWhatsAppSender,
  );

  return {
    controller,
    paymentProvider,
    executionService,
    identityService,
    sender,
  };
}

/** Builds a minimal valid Flutterwave charge.completed body. */
function chargeCompletedBody(txRef: string = TX_REF) {
  return {
    event: 'charge.completed',
    data: {
      status: 'successful',
      tx_ref: txRef,
      amount: 10000,
      currency: 'NGN',
      customer: { email: 'user@test.com', name: 'Test User' },
      flw_ref: 'flw-ref-001',
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FlutterwaveWebhookController', () => {
  // Suppress logger noise in tests
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /webhooks/flutterwave', () => {
    // ── Happy path ────────────────────────────────────────────────────────────

    it('valid verif-hash + charge.completed + settle returns completed → calls settleBuyPayment, resolves address, sendText called with receiptNumber, returns 200', async () => {
      const { controller, executionService, identityService, sender } =
        makeController();

      const req = {
        headers: { 'verif-hash': VALID_HASH },
      };

      const result = await controller.handleWebhook(
        chargeCompletedBody(),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });

      // settleBuyPayment must be called with the tx_ref as the reference
      expect(executionService.settleBuyPayment).toHaveBeenCalledWith({
        reference: TX_REF,
      });

      // identity lookup and sendText must happen
      expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);
      expect(sender.sendText).toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.stringContaining(RECEIPT_NUMBER),
      );
    });

    // ── Auth failure ──────────────────────────────────────────────────────────

    it('invalid verif-hash → returns 401, settleBuyPayment NOT called', async () => {
      const { controller, executionService } = makeController({
        verifyResult: false,
      });

      const req = { headers: { 'verif-hash': 'wrong-hash' } };

      await expect(
        controller.handleWebhook(chargeCompletedBody(), req as any),
      ).rejects.toMatchObject({ status: 401 });

      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    });

    // ── Non-matching event ────────────────────────────────────────────────────

    it('non-success event (event !== charge.completed) → returns 200, settleBuyPayment NOT called', async () => {
      const { controller, executionService } = makeController();

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        {
          event: 'transfer.completed',
          data: { status: 'successful', tx_ref: TX_REF },
        },
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    });

    it('event is charge.completed but data.status is not successful → returns 200, settleBuyPayment NOT called', async () => {
      const { controller, executionService } = makeController();

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        {
          event: 'charge.completed',
          data: { status: 'failed', tx_ref: TX_REF },
        },
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    });

    it('missing tx_ref → returns 200, settleBuyPayment NOT called', async () => {
      const { controller, executionService } = makeController();

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        {
          event: 'charge.completed',
          data: { status: 'successful' }, // no tx_ref
        },
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    });

    // ── Pending result ────────────────────────────────────────────────────────

    it('settleBuyPayment returns pending → returns 200, sendText NOT called', async () => {
      const { controller, sender } = makeController({
        settleResult: 'pending',
      });

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        chargeCompletedBody(),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    // ── Error swallowing ──────────────────────────────────────────────────────

    it('settleBuyPayment throws → returns 200 (error swallowed + logged), does not rethrow', async () => {
      const { controller } = makeController({ settleResult: 'throw' });

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        chargeCompletedBody(),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
    });

    // ── WhatsApp address not found ────────────────────────────────────────────

    it('address not found → returns 200, settle happened, sendText NOT called', async () => {
      const { controller, executionService, sender } = makeController({
        waAddress: null,
      });

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        chargeCompletedBody(),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleBuyPayment).toHaveBeenCalledWith({
        reference: TX_REF,
      });
      expect(sender.sendText).not.toHaveBeenCalled();
    });
  });
});
