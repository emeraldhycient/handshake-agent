/**
 * Unit tests for FlutterwaveWebhookController (Task 6.4).
 *
 * Covers the ack-then-process contract:
 *   charge.completed:
 *   - valid verif-hash + charge.completed + settle returns completed → receipt sent
 *   - invalid verif-hash → 401, nothing called
 *   - non-success event or missing tx_ref → 200, settleBuyPayment NOT called
 *   - settleBuyPayment returns pending → 200, no receipt
 *   - settleBuyPayment throws → 200 (error swallowed + logged)
 *   - WhatsApp address not found → 200, settle happened, no send
 *
 *   transfer.completed:
 *   - SUCCESSFUL status + reference → settleSellPayout called, receipt sent on completed
 *   - FAILED status + reference → settleSellPayout called (engine refunds internally)
 *   - unknown status → 200, settleSellPayout NOT called
 *   - missing reference → 200, settleSellPayout NOT called
 *   - settleSellPayout throws → 200 (error swallowed)
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
const SELL_REFERENCE = 'sell-idempotency-key-uuid-456';
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
    createPayout: jest.fn(),
    verifyPayout: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(verifyResult),
  };
}

function makeExecutionService(
  settleBuyResult: 'completed' | 'pending' | 'throw' = 'completed',
  settleSellResult: 'completed' | 'failed' | 'pending' | 'throw' = 'completed',
): jest.Mocked<
  Pick<ExecutionService, 'settleBuyPayment' | 'settleSellPayout'>
> {
  let settleBuyFn: jest.Mock;
  if (settleBuyResult === 'throw') {
    settleBuyFn = jest.fn().mockRejectedValue(new Error('settlement boom'));
  } else if (settleBuyResult === 'pending') {
    settleBuyFn = jest.fn().mockResolvedValue({
      transactionId: TXN_ID,
      status: 'pending',
    });
  } else {
    settleBuyFn = jest.fn().mockResolvedValue({
      transactionId: TXN_ID,
      status: 'completed',
      receiptNumber: RECEIPT_NUMBER,
      userId: USER_ID,
    });
  }

  let settleSellFn: jest.Mock;
  if (settleSellResult === 'throw') {
    settleSellFn = jest
      .fn()
      .mockRejectedValue(new Error('sell settlement boom'));
  } else if (settleSellResult === 'pending') {
    settleSellFn = jest.fn().mockResolvedValue({
      transactionId: TXN_ID,
      status: 'pending',
    });
  } else if (settleSellResult === 'failed') {
    settleSellFn = jest.fn().mockResolvedValue({
      transactionId: TXN_ID,
      status: 'failed',
      userId: USER_ID,
    });
  } else {
    settleSellFn = jest.fn().mockResolvedValue({
      transactionId: TXN_ID,
      status: 'completed',
      receiptNumber: RECEIPT_NUMBER,
      userId: USER_ID,
    });
  }

  return {
    settleBuyPayment: settleBuyFn,
    settleSellPayout: settleSellFn,
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
    settleSellResult?: 'completed' | 'failed' | 'pending' | 'throw';
    waAddress?: string | null;
  } = {},
) {
  const paymentProvider = makePaymentProvider(overrides.verifyResult ?? true);
  const executionService = makeExecutionService(
    overrides.settleResult ?? 'completed',
    overrides.settleSellResult ?? 'completed',
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

    it('unknown event (not charge.completed or transfer.completed) → returns 200, no settlement called', async () => {
      const { controller, executionService } = makeController();

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        {
          event: 'refund.completed',
          data: { status: 'successful', tx_ref: TX_REF },
        },
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
      expect(executionService.settleSellPayout).not.toHaveBeenCalled();
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

  // ---------------------------------------------------------------------------
  // transfer.completed (sell payout webhook)
  // ---------------------------------------------------------------------------

  describe('transfer.completed webhook', () => {
    /** Builds a minimal valid Flutterwave transfer.completed body. */
    function transferCompletedBody(
      status: string = 'SUCCESSFUL',
      reference: string = SELL_REFERENCE,
    ) {
      return {
        event: 'transfer.completed',
        data: {
          status,
          reference,
          id: 123456,
          amount: 5000,
          currency: 'NGN',
        },
      };
    }

    it('SUCCESSFUL status + reference → settleSellPayout called, receipt sent when completed', async () => {
      const { controller, executionService, identityService, sender } =
        makeController({ settleSellResult: 'completed' });

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        transferCompletedBody('SUCCESSFUL'),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleSellPayout).toHaveBeenCalledWith({
        reference: SELL_REFERENCE,
      });
      expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);
      expect(sender.sendText).toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.stringContaining(RECEIPT_NUMBER),
      );
      // Buy settlement must NOT be called
      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    });

    it('FAILED status + reference → settleSellPayout called (engine refunds internally)', async () => {
      const { controller, executionService, identityService, sender } =
        makeController({ settleSellResult: 'failed' });

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        transferCompletedBody('FAILED'),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleSellPayout).toHaveBeenCalledWith({
        reference: SELL_REFERENCE,
      });
      // Receipt still sent for failed (refund notice)
      expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);
      expect(sender.sendText).toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.any(String),
      );
      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    });

    it('unknown status → returns 200, settleSellPayout NOT called', async () => {
      const { controller, executionService } = makeController();

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        transferCompletedBody('PENDING'),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleSellPayout).not.toHaveBeenCalled();
    });

    it('missing reference → returns 200, settleSellPayout NOT called', async () => {
      const { controller, executionService } = makeController();

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        { event: 'transfer.completed', data: { status: 'SUCCESSFUL' } },
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleSellPayout).not.toHaveBeenCalled();
    });

    it('settleSellPayout throws → returns 200 (error swallowed), does not rethrow', async () => {
      const { controller } = makeController({ settleSellResult: 'throw' });

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        transferCompletedBody('SUCCESSFUL'),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
    });

    it('settleSellPayout returns pending → returns 200, sendText NOT called', async () => {
      const { controller, executionService, sender } = makeController({
        settleSellResult: 'pending',
      });

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        transferCompletedBody('SUCCESSFUL'),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleSellPayout).toHaveBeenCalled();
      expect(sender.sendText).not.toHaveBeenCalled();
    });

    it('invalid verif-hash on transfer.completed → returns 401, settleSellPayout NOT called', async () => {
      const { controller, executionService } = makeController({
        verifyResult: false,
      });

      const req = { headers: { 'verif-hash': 'wrong-hash' } };

      await expect(
        controller.handleWebhook(
          transferCompletedBody('SUCCESSFUL'),
          req as any,
        ),
      ).rejects.toMatchObject({ status: 401 });

      expect(executionService.settleSellPayout).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Legacy flat collection format (real captured sandbox VA pay-in)
  //   No top-level `event`; camelCase top-level `txRef` + `status`.
  // ---------------------------------------------------------------------------

  describe('legacy flat collection webhook (no event field)', () => {
    /**
     * Builds a minimal legacy flat VA collection body — mirrors the real
     * captured sandbox payload: top-level `txRef` + `status`, NO `event`.
     */
    function legacyCollectionBody(
      status: string = 'successful',
      txRef: string = TX_REF,
    ) {
      return {
        id: 10335848,
        txRef,
        flwRef: 'FLW-MOCK-abc123',
        amount: 5000,
        charged_amount: 5000,
        status,
        currency: 'NGN',
        customer: { email: 'user@test.com', name: 'Test User' },
        entity: { account_number: '0034236600' },
      };
    }

    it('legacy successful VA pay-in → settleBuyPayment(txRef), receipt sent, returns 200', async () => {
      const { controller, executionService, identityService, sender } =
        makeController();

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        legacyCollectionBody('successful'),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleBuyPayment).toHaveBeenCalledWith({
        reference: TX_REF,
      });
      expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);
      expect(sender.sendText).toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.stringContaining(RECEIPT_NUMBER),
      );
      // No sell path on a collection.
      expect(executionService.settleSellPayout).not.toHaveBeenCalled();
    });

    it('legacy non-successful status → returns 200, settleBuyPayment NOT called', async () => {
      const { controller, executionService } = makeController();

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        legacyCollectionBody('failed'),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    });

    it('legacy successful but empty txRef → returns 200, settleBuyPayment NOT called', async () => {
      const { controller, executionService } = makeController();

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        legacyCollectionBody('successful', ''),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    });

    it('legacy invalid verif-hash → 401, settleBuyPayment NOT called', async () => {
      const { controller, executionService } = makeController({
        verifyResult: false,
      });

      const req = { headers: { 'verif-hash': 'wrong-hash' } };

      await expect(
        controller.handleWebhook(
          legacyCollectionBody('successful'),
          req as any,
        ),
      ).rejects.toMatchObject({ status: 401 });

      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    });

    it('eventless + no txRef and no transfer reference → returns 200, nothing called', async () => {
      const { controller, executionService } = makeController();

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        { id: 999, status: 'successful', amount: 100 },
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
      expect(executionService.settleSellPayout).not.toHaveBeenCalled();
    });

    it('v3 charge.completed still routes to settleBuyPayment (no regression)', async () => {
      const { controller, executionService } = makeController();

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        chargeCompletedBody(),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleBuyPayment).toHaveBeenCalledWith({
        reference: TX_REF,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Legacy flat transfer/payout format (no event field)
  //   No top-level `event`; top-level `reference` + uppercase `status`.
  // ---------------------------------------------------------------------------

  describe('legacy flat transfer webhook (no event field)', () => {
    /**
     * Builds a minimal legacy flat payout body — top-level `reference` +
     * `status` (SUCCESSFUL/FAILED), NO `event`, NO `txRef`.
     */
    function legacyTransferBody(
      status: string = 'SUCCESSFUL',
      reference: string = SELL_REFERENCE,
    ) {
      return {
        id: 7766554,
        reference,
        account_number: '0690000040',
        bank_name: 'Access Bank',
        amount: 5000,
        currency: 'NGN',
        status,
        complete_message: 'Successful',
      };
    }

    it('legacy SUCCESSFUL transfer → settleSellPayout(reference), receipt sent, returns 200', async () => {
      const { controller, executionService, identityService, sender } =
        makeController({ settleSellResult: 'completed' });

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        legacyTransferBody('SUCCESSFUL'),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleSellPayout).toHaveBeenCalledWith({
        reference: SELL_REFERENCE,
      });
      expect(identityService.findWhatsAppAddress).toHaveBeenCalledWith(USER_ID);
      expect(sender.sendText).toHaveBeenCalledWith(
        WA_ADDRESS,
        expect.stringContaining(RECEIPT_NUMBER),
      );
      // A legacy transfer must NOT be misrouted to the buy path.
      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    });

    it('legacy FAILED transfer → settleSellPayout(reference) (engine refunds internally)', async () => {
      const { controller, executionService } = makeController({
        settleSellResult: 'failed',
      });

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        legacyTransferBody('FAILED'),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleSellPayout).toHaveBeenCalledWith({
        reference: SELL_REFERENCE,
      });
      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    });

    it('legacy transfer with unhandled status → returns 200, settleSellPayout NOT called', async () => {
      const { controller, executionService } = makeController();

      const req = { headers: { 'verif-hash': VALID_HASH } };

      const result = await controller.handleWebhook(
        legacyTransferBody('PENDING'),
        req as any,
      );

      expect(result).toEqual({ status: 'ok' });
      expect(executionService.settleSellPayout).not.toHaveBeenCalled();
      expect(executionService.settleBuyPayment).not.toHaveBeenCalled();
    });
  });
});
