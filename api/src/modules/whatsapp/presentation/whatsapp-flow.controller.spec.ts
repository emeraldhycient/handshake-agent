/**
 * TDD — whatsapp-flow.controller.spec.ts (Task 6.2 + S3)
 *
 * Tests the WhatsApp Flow data endpoint controller:
 *   - ping → encryptResponse called with {data:{status:'active'}}
 *   - data_exchange happy path → executeBuy called; SUCCESS screen returned
 *   - executeBuy throws PinInvalidError → ERROR screen, no internals leaked
 *   - decryptRequest throws → controller responds HTTP 421
 *   - data_exchange / beneficiary_add (bank) → BeneficiaryService.addBankAccount called; BENEFICIARY_ADDED screen
 *   - data_exchange / beneficiary_add (crypto invalid) → InvalidAddressError → ERROR screen
 *   - data_exchange / beneficiary_select → validates ownership; non-owned → ERROR screen
 *   - data_exchange / beneficiary_select (found) → BENEFICIARY_CONFIRMED screen
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
import { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import { InvalidAddressError } from '../../beneficiaries/domain/beneficiary-errors';
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

  let mockBeneficiaryService: {
    addBankAccount: jest.Mock;
    addCryptoAddress: jest.Mock;
    getById: jest.Mock;
    listForUser: jest.Mock;
    getDefault: jest.Mock;
    requireById: jest.Mock;
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

    mockBeneficiaryService = {
      addBankAccount: jest.fn(),
      addCryptoAddress: jest.fn(),
      getById: jest.fn(),
      listForUser: jest.fn(),
      getDefault: jest.fn(),
      requireById: jest.fn(),
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
        { provide: BeneficiaryService, useValue: mockBeneficiaryService },
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

  // ── beneficiary_add (bank account) ────────────────────────────────────────

  describe('data_exchange / beneficiary_add (bank account)', () => {
    beforeEach(() => {
      mockFlowCrypto.decryptRequest.mockReturnValue({
        decrypted: {
          version: '3.0',
          action: 'data_exchange',
          flow_token: 'tok',
          data: {
            action: 'beneficiary_add',
            accountNumber: '0123456789',
            bankCode: '058',
            accountName: 'John Doe',
            label: 'GTB Savings',
          },
        },
        aesKey: MOCK_AES_KEY,
        iv: MOCK_IV,
      });
    });

    it('calls BeneficiaryService.addBankAccount with the correct args', async () => {
      mockBeneficiaryService.addBankAccount.mockResolvedValue({
        id: 'ben-id-1',
        label: 'GTB Savings',
      });

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockBeneficiaryService.addBankAccount).toHaveBeenCalledWith({
        userId: 'user-001',
        accountNumber: '0123456789',
        bankCode: '058',
        accountName: 'John Doe',
        label: 'GTB Savings',
      });
    });

    it('returns BENEFICIARY_ADDED screen with the new beneficiaryId', async () => {
      mockBeneficiaryService.addBankAccount.mockResolvedValue({
        id: 'ben-id-1',
        label: 'GTB Savings',
      });

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({
        screen: 'BENEFICIARY_ADDED',
        data: { beneficiaryId: 'ben-id-1' },
      });
    });

    it('does NOT call executeBuy for a beneficiary_add action', async () => {
      mockBeneficiaryService.addBankAccount.mockResolvedValue({
        id: 'ben-id-1',
        label: 'GTB Savings',
      });

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockExecutionService.executeBuy).not.toHaveBeenCalled();
    });
  });

  // ── beneficiary_add (crypto address — invalid) ───────────────────────────

  describe('data_exchange / beneficiary_add (crypto — InvalidAddressError)', () => {
    it('returns ERROR screen when InvalidAddressError is thrown', async () => {
      mockFlowCrypto.decryptRequest.mockReturnValue({
        decrypted: {
          version: '3.0',
          action: 'data_exchange',
          flow_token: 'tok',
          data: {
            action: 'beneficiary_add',
            address: 'bad-address',
            network: 'TRON',
            asset: 'USDT',
            label: 'Bad wallet',
          },
        },
        aesKey: MOCK_AES_KEY,
        iv: MOCK_IV,
      });

      mockBeneficiaryService.addCryptoAddress.mockRejectedValue(
        new InvalidAddressError('TRON', 'bad-address'),
      );

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'ERROR' });
      const data = encryptedWith.data as Record<string, unknown>;
      expect(typeof data.message).toBe('string');
      // No internal details
      expect(JSON.stringify(encryptedWith)).not.toContain('bad-address');
    });
  });

  // ── beneficiary_select ───────────────────────────────────────────────────

  describe('data_exchange / beneficiary_select', () => {
    it('returns ERROR screen when beneficiary does not belong to the user', async () => {
      mockFlowCrypto.decryptRequest.mockReturnValue({
        decrypted: {
          version: '3.0',
          action: 'data_exchange',
          flow_token: 'tok',
          data: {
            action: 'beneficiary_select',
            beneficiaryId: 'other-users-ben',
          },
        },
        aesKey: MOCK_AES_KEY,
        iv: MOCK_IV,
      });

      // Simulate not found (null = doesn't belong to this user).
      mockBeneficiaryService.getById.mockResolvedValue(null);

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'ERROR' });
    });

    it('returns BENEFICIARY_CONFIRMED screen when beneficiary belongs to user', async () => {
      mockFlowCrypto.decryptRequest.mockReturnValue({
        decrypted: {
          version: '3.0',
          action: 'data_exchange',
          flow_token: 'tok',
          data: {
            action: 'beneficiary_select',
            beneficiaryId: 'ben-id-1',
          },
        },
        aesKey: MOCK_AES_KEY,
        iv: MOCK_IV,
      });

      mockBeneficiaryService.getById.mockResolvedValue({
        id: 'ben-id-1',
        label: 'GTB Savings',
        userId: 'user-001',
      });

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({
        screen: 'BENEFICIARY_CONFIRMED',
        data: { beneficiaryId: 'ben-id-1' },
      });
    });

    it('calls getById with the correct userId from the flow_token', async () => {
      mockFlowCrypto.decryptRequest.mockReturnValue({
        decrypted: {
          version: '3.0',
          action: 'data_exchange',
          flow_token: 'tok',
          data: {
            action: 'beneficiary_select',
            beneficiaryId: 'ben-id-1',
          },
        },
        aesKey: MOCK_AES_KEY,
        iv: MOCK_IV,
      });

      mockBeneficiaryService.getById.mockResolvedValue({
        id: 'ben-id-1',
        label: 'GTB Savings',
        userId: 'user-001',
      });

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      // verifyFlowToken returns userId: 'user-001' (see beforeEach spy)
      expect(mockBeneficiaryService.getById).toHaveBeenCalledWith(
        'user-001',
        'ben-id-1',
      );
    });
  });
});
