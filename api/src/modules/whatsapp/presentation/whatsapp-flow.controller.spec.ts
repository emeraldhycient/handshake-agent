/**
 * TDD — whatsapp-flow.controller.spec.ts (Task 6.2)
 *
 * Tests the WhatsApp Flow data endpoint controller:
 *   - ping → encryptResponse called with {data:{status:'active'}}
 *   - data_exchange happy path → executeBuy called; SUCCESS screen returned
 *   - executeBuy throws PinInvalidError → ERROR screen, no internals leaked
 *   - decryptRequest throws → controller responds HTTP 421
 */

import { Test } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import { FLOW_CRYPTO } from '../application/ports/flow-crypto.port';
import {
  FlowDecryptError,
  FlowKeyNotConfiguredError,
} from '../domain/flow-errors';
import { ExecutionService } from '../../transactions/application/execution.service';
import { PinInvalidError } from '../../../core/auth/domain/pin-errors';
import { WhatsAppFlowController } from './whatsapp-flow.controller';
import * as flowToken from '../application/flow-token';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_AES_KEY = Buffer.alloc(16, 1);
const MOCK_IV = Buffer.alloc(16, 2);
const ENCRYPTED_SENTINEL = 'ENCRYPTED_SENTINEL';

function makeEncryptedBody() {
  return {
    encrypted_flow_data: 'data',
    encrypted_aes_key: 'key',
    initial_vector: 'iv',
  };
}

function makeRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

/** Typed capture helper: pulls the first arg passed to encryptResponse. */
function captureEncryptArg(
  mock: jest.Mock<string, [unknown, Buffer, Buffer]>,
): Record<string, unknown> {
  const calls = mock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WhatsAppFlowController', () => {
  let controller: WhatsAppFlowController;

  let mockFlowCrypto: {
    decryptRequest: jest.Mock;
    encryptResponse: jest.Mock<string, [unknown, Buffer, Buffer]>;
  };

  let mockExecutionService: {
    executeBuy: jest.Mock;
  };

  let mockConfigService: {
    get: jest.Mock;
  };

  beforeEach(async () => {
    mockFlowCrypto = {
      decryptRequest: jest.fn(),
      encryptResponse: jest
        .fn<string, [unknown, Buffer, Buffer]>()
        .mockReturnValue(ENCRYPTED_SENTINEL),
    };

    mockExecutionService = {
      executeBuy: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('test-signing-key'),
    };

    // Spy on verifyFlowToken (imported function) — replaced per test.
    jest.spyOn(flowToken, 'verifyFlowToken').mockReturnValue({
      proposalId: 'prop-abc',
      directiveId: 'dir-xyz',
      userId: 'user-001',
      exp: Math.floor(Date.now() / 1000) + 300,
    });

    const module = await Test.createTestingModule({
      controllers: [WhatsAppFlowController],
      providers: [
        { provide: FLOW_CRYPTO, useValue: mockFlowCrypto },
        { provide: ExecutionService, useValue: mockExecutionService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<WhatsAppFlowController>(WhatsAppFlowController);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── ping ──────────────────────────────────────────────────────────────────

  describe('ping action', () => {
    it('returns encrypted {data:{status:"active"}} and calls encryptResponse with that object', async () => {
      mockFlowCrypto.decryptRequest.mockReturnValue({
        decrypted: { version: '3.0', action: 'ping' },
        aesKey: MOCK_AES_KEY,
        iv: MOCK_IV,
      });

      const result = await controller.handleFlow(
        makeEncryptedBody(),
        makeRes(),
      );

      expect(mockFlowCrypto.encryptResponse).toHaveBeenCalledWith(
        { data: { status: 'active' } },
        MOCK_AES_KEY,
        MOCK_IV,
      );
      expect(result).toBe(ENCRYPTED_SENTINEL);
    });
  });

  // ── data_exchange (happy path) ────────────────────────────────────────────

  describe('data_exchange happy path', () => {
    const TOKEN = 'valid.token';
    const EXEC_RESULT = {
      transactionId: 'txn-111',
      status: 'settling' as const,
      payment: {
        accountNumber: 'ACCT-99999',
        bankName: 'Test Bank',
        providerRef: 'ref-999',
        amount: '50000',
        currency: 'NGN' as const,
      },
    };

    beforeEach(() => {
      mockFlowCrypto.decryptRequest.mockReturnValue({
        decrypted: {
          version: '3.0',
          action: 'data_exchange',
          flow_token: TOKEN,
          data: { pin: 'PIN_SENTINEL_9191', nonce: 'nonce-abc' },
        },
        aesKey: MOCK_AES_KEY,
        iv: MOCK_IV,
      });

      mockExecutionService.executeBuy.mockResolvedValue(EXEC_RESULT);
    });

    it('calls executeBuy with correct args (userId, proposalId, directiveId, nonce, pin, idempotencyKey)', async () => {
      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockExecutionService.executeBuy).toHaveBeenCalledWith({
        userId: 'user-001',
        proposalId: 'prop-abc',
        directiveId: 'dir-xyz',
        nonce: 'nonce-abc',
        pin: 'PIN_SENTINEL_9191',
        idempotencyKey: 'prop-abc',
      });
    });

    it('returns SUCCESS screen with VA details and does NOT include pin in the encrypted object', async () => {
      await controller.handleFlow(makeEncryptedBody(), makeRes());

      // Use typed helper to capture the first arg passed to encryptResponse.
      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({
        screen: 'SUCCESS',
        data: {
          transactionId: EXEC_RESULT.transactionId,
          accountNumber: EXEC_RESULT.payment.accountNumber,
          bankName: EXEC_RESULT.payment.bankName,
          amount: EXEC_RESULT.payment.amount,
          currency: EXEC_RESULT.payment.currency,
        },
      });
      // PIN must NOT appear anywhere in the response object.
      const serialised = JSON.stringify(encryptedWith);
      expect(serialised).not.toContain('PIN_SENTINEL_9191');
      expect(serialised).not.toContain('"pin"');
    });

    it('returns the encrypted sentinel as the response', async () => {
      const result = await controller.handleFlow(
        makeEncryptedBody(),
        makeRes(),
      );
      expect(result).toBe(ENCRYPTED_SENTINEL);
    });
  });

  // ── data_exchange → PinInvalidError → ERROR screen ───────────────────────

  describe('data_exchange when executeBuy throws PinInvalidError', () => {
    it('returns ERROR screen with friendly message and no internal details', async () => {
      mockFlowCrypto.decryptRequest.mockReturnValue({
        decrypted: {
          version: '3.0',
          action: 'data_exchange',
          flow_token: 'token',
          data: { pin: 'PIN_WRONG_SECRET', nonce: 'n' },
        },
        aesKey: MOCK_AES_KEY,
        iv: MOCK_IV,
      });

      mockExecutionService.executeBuy.mockRejectedValue(new PinInvalidError(3));

      const result = await controller.handleFlow(
        makeEncryptedBody(),
        makeRes(),
      );

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'ERROR' });
      const data = encryptedWith.data as Record<string, unknown>;
      expect(data.message).toBeDefined();
      expect(typeof data.message).toBe('string');
      // Must not leak internal error text or PIN.
      expect(JSON.stringify(encryptedWith)).not.toContain('PIN_WRONG_SECRET');
      expect(JSON.stringify(encryptedWith)).not.toContain('PIN_INVALID');
      expect(result).toBe(ENCRYPTED_SENTINEL);
    });
  });

  // ── decrypt failure → HTTP 421 ────────────────────────────────────────────

  describe('when decryptRequest throws FlowDecryptError', () => {
    it('throws an HttpException with status 421', async () => {
      mockFlowCrypto.decryptRequest.mockImplementation(() => {
        throw new FlowDecryptError(new Error('bad tag'));
      });

      let thrownError: unknown;
      try {
        await controller.handleFlow(makeEncryptedBody(), makeRes());
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(HttpException);
      expect((thrownError as HttpException).getStatus()).toBe(421);
    });
  });

  describe('when decryptRequest throws FlowKeyNotConfiguredError', () => {
    it('throws an HttpException with status 421', async () => {
      mockFlowCrypto.decryptRequest.mockImplementation(() => {
        throw new FlowKeyNotConfiguredError();
      });

      let thrownError: unknown;
      try {
        await controller.handleFlow(makeEncryptedBody(), makeRes());
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(HttpException);
      expect((thrownError as HttpException).getStatus()).toBe(421);
    });
  });
});
