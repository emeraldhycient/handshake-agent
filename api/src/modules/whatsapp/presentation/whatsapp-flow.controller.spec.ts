/**
 * TDD — whatsapp-flow.controller.spec.ts (Task 6.2 + S3 + W1)
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
 *   - (W1) data_exchange for 'sell' proposal type → executeSell called, SUCCESS screen
 *   - (W1) data_exchange for 'send' proposal type → executeSend called, SUCCESS screen
 *   - (W1) data_exchange for 'buy' proposal type → executeBuy called (unchanged)
 *   - (Task 11) data_exchange / send_to_address → createSendProposal called with a
 *     raw_address descriptor; itemized SEND_CONFIRM screen returned; invalid
 *     address / sanctions / self-send map to an ERROR screen, never a 5xx.
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
import { ProposalService } from '../../transactions/application/proposal.service';
import { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import { InvalidAddressError } from '../../beneficiaries/domain/beneficiary-errors';
import { InvalidSendAddressError } from '../../transactions/domain/invalid-send-address.error';
import { SelfSendError } from '../../transactions/domain/amount-guard-errors';
import { SanctionsBlockedError } from '../../compliance/domain/compliance-errors';
import { PinInvalidError } from '../../../core/auth/domain/pin-errors';
import { CapabilityTierError } from '../../identity/domain/gate-errors';
import { PinService } from '../../../core/auth/pin.service';
import { SessionService } from '../../../core/auth/session.service';
import { StepUpService } from '../../../core/auth/step-up.service';
import { WhatsAppFlowController } from './whatsapp-flow.controller';
import * as flowToken from '../application/flow-token';
import { PROPOSAL_REPOSITORY } from '../../transactions/application/ports/proposal.repository.port';

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
    executeSell: jest.Mock;
    executeSend: jest.Mock;
  };

  let mockBeneficiaryService: {
    addBankAccount: jest.Mock;
    addCryptoAddress: jest.Mock;
    getById: jest.Mock;
    listForUser: jest.Mock;
    getDefault: jest.Mock;
    requireById: jest.Mock;
  };

  let mockProposalService: {
    createSendProposal: jest.Mock;
  };

  let mockProposalRepository: {
    getType: jest.Mock;
    listPendingForUser: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    updateStatus: jest.Mock;
  };

  let mockConfigService: {
    get: jest.Mock;
  };

  let mockPinService: {
    verifyPin: jest.Mock;
  };

  let mockSessionService: {
    findDeviceIdByFingerprint: jest.Mock;
    findPinnedDeviceId: jest.Mock;
    startOrTouch: jest.Mock;
    recordStepUp: jest.Mock;
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
      executeSell: jest.fn(),
      executeSend: jest.fn(),
    };

    mockBeneficiaryService = {
      addBankAccount: jest.fn(),
      addCryptoAddress: jest.fn(),
      getById: jest.fn(),
      listForUser: jest.fn(),
      getDefault: jest.fn(),
      requireById: jest.fn(),
    };

    mockProposalRepository = {
      getType: jest.fn().mockResolvedValue('buy'),
      listPendingForUser: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
    };

    mockProposalService = {
      createSendProposal: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('test-signing-key'),
    };

    // Step-up-on-add primitives (R2): PIN verify + device-bound step-up record.
    // Defaults to the happy path — a valid PIN and a resolvable pinned device.
    mockPinService = {
      verifyPin: jest.fn().mockResolvedValue(undefined),
    };

    mockSessionService = {
      findDeviceIdByFingerprint: jest.fn().mockResolvedValue(null),
      findPinnedDeviceId: jest.fn().mockResolvedValue('device-wa-1'),
      startOrTouch: jest.fn().mockResolvedValue(undefined),
      recordStepUp: jest.fn().mockResolvedValue(undefined),
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
        { provide: ProposalService, useValue: mockProposalService },
        { provide: BeneficiaryService, useValue: mockBeneficiaryService },
        { provide: PROPOSAL_REPOSITORY, useValue: mockProposalRepository },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PinService, useValue: mockPinService },
        { provide: SessionService, useValue: mockSessionService },
        // The controller now depends on the shared StepUpService (A1). Provide
        // the REAL service wired to the mock Pin/Session so the step-up
        // behavioural assertions below still hold unchanged.
        StepUpService,
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

  // ── data_exchange → CapabilityTierError → actionable ERROR screen ────────
  // Task 1.3 regression guard: a tier downgrade between proposal creation and
  // WhatsApp Flow PIN confirmation must surface an actionable message, not the
  // generic "Something went wrong" fallback (mapExecutionError previously had
  // no branch for CapabilityTierError).

  describe('data_exchange when execution throws CapabilityTierError', () => {
    it('returns an actionable ERROR screen, not the generic fallback', async () => {
      mockFlowCrypto.decryptRequest.mockReturnValue({
        decrypted: {
          version: '3.0',
          action: 'data_exchange',
          flow_token: 'token',
          data: { pin: 'PIN_SENTINEL_9191', nonce: 'n' },
        },
        aesKey: MOCK_AES_KEY,
        iv: MOCK_IV,
      });

      mockExecutionService.executeBuy.mockRejectedValue(
        new CapabilityTierError('crypto.send', 'tier_2', 'tier_1'),
      );

      const result = await controller.handleFlow(
        makeEncryptedBody(),
        makeRes(),
      );

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({
        screen: 'ERROR',
        data: {
          message:
            'Verify your identity to unlock this. Sending, selling and swapping need identity verification — open the app to verify.',
        },
      });
      const data = encryptedWith.data as Record<string, unknown>;
      // Must be the actionable message, not the generic catch-all fallback.
      expect(data.message).not.toBe(
        'Something went wrong. Please try again or contact support.',
      );
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
    /**
     * Bank beneficiary_add now runs inside the E2E Flow with a PIN (§3.5) and
     * the payout currency seeded from the sell intent (Wave G). The controller
     * derives the country server-side (never trusts the client) and gates the
     * write behind PIN + device-bound step-up (R2) before persisting.
     */
    function makeBankAddBody(
      extra: Record<string, unknown> = { pin: 'PIN_ADD_9191', currency: 'NGN' },
    ) {
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
            ...extra,
          },
        },
        aesKey: MOCK_AES_KEY,
        iv: MOCK_IV,
      });
    }

    beforeEach(() => {
      makeBankAddBody();
    });

    it('calls BeneficiaryService.addBankAccount with the currency (country derived server-side)', async () => {
      mockBeneficiaryService.addBankAccount.mockResolvedValue({
        id: 'ben-id-1',
        label: 'GTB Savings',
        verificationStatus: 'verified',
      });

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockBeneficiaryService.addBankAccount).toHaveBeenCalledWith({
        userId: 'user-001',
        accountNumber: '0123456789',
        bankCode: '058',
        accountName: 'John Doe',
        label: 'GTB Savings',
        currency: 'NGN',
      });
    });

    it('verifies the PIN and records a device-bound step-up BEFORE persisting (R2)', async () => {
      mockBeneficiaryService.addBankAccount.mockResolvedValue({
        id: 'ben-id-1',
        label: 'GTB Savings',
        verificationStatus: 'verified',
      });

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockPinService.verifyPin).toHaveBeenCalledWith(
        'user-001',
        'PIN_ADD_9191',
      );
      expect(mockSessionService.recordStepUp).toHaveBeenCalledWith(
        'user-001',
        'device-wa-1',
        expect.any(Date),
      );
    });

    it('returns BENEFICIARY_ADDED screen with the new beneficiaryId and never leaks the PIN', async () => {
      mockBeneficiaryService.addBankAccount.mockResolvedValue({
        id: 'ben-id-1',
        label: 'GTB Savings',
        verificationStatus: 'verified',
      });

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({
        screen: 'BENEFICIARY_ADDED',
        data: { beneficiaryId: 'ben-id-1' },
      });
      const serialised = JSON.stringify(encryptedWith);
      expect(serialised).not.toContain('PIN_ADD_9191');
      expect(serialised).not.toContain('"pin"');
    });

    it('surfaces the unverified state in the reply for a non-NGN (name-enquiry-unsupported) add', async () => {
      makeBankAddBody({ pin: 'PIN_ADD_9191', currency: 'GHS' });
      mockBeneficiaryService.addBankAccount.mockResolvedValue({
        id: 'ben-gh-1',
        label: 'GTB Savings',
        verificationStatus: 'unverified',
      });

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockBeneficiaryService.addBankAccount).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'GHS' }),
      );
      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'BENEFICIARY_ADDED' });
      const data = encryptedWith.data as Record<string, unknown>;
      expect(String(data.message)).toMatch(/could not|couldn't|verify/i);
    });

    it('returns ERROR and does NOT persist when the PIN is missing (§3.5 — no plaintext PIN)', async () => {
      makeBankAddBody({ currency: 'NGN' }); // no pin

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockBeneficiaryService.addBankAccount).not.toHaveBeenCalled();
      expect(mockPinService.verifyPin).not.toHaveBeenCalled();
      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'ERROR' });
    });

    it('returns ERROR and does NOT persist when the PIN is wrong (PinInvalidError)', async () => {
      mockPinService.verifyPin.mockRejectedValue(new PinInvalidError(3));

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockBeneficiaryService.addBankAccount).not.toHaveBeenCalled();
      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'ERROR' });
      expect(JSON.stringify(encryptedWith)).not.toContain('PIN_INVALID');
    });

    it('returns ERROR and does NOT persist when no device can be bound (StepUpRequiredError)', async () => {
      mockSessionService.findPinnedDeviceId.mockResolvedValue(null);

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockBeneficiaryService.addBankAccount).not.toHaveBeenCalled();
      expect(mockSessionService.recordStepUp).not.toHaveBeenCalled();
      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'ERROR' });
    });

    it('does NOT call executeBuy for a beneficiary_add action', async () => {
      mockBeneficiaryService.addBankAccount.mockResolvedValue({
        id: 'ben-id-1',
        label: 'GTB Savings',
        verificationStatus: 'verified',
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
            pin: 'PIN_ADD_9191',
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

  // ── send_to_address (Task 11) ─────────────────────────────────────────────

  describe('data_exchange / send_to_address', () => {
    const RAW_CONFIRMATION = {
      proposalId: 'prop-raw-1',
      asset: 'USDT',
      cryptoAmount: '5',
      network: 'TRON',
      networkFeeCrypto: '1',
      totalDebit: '6',
      toAddressMasked: 'TRawAd...0001',
      expiresAt: new Date().toISOString(),
    };

    function makeSendToAddressBody(extra: Record<string, unknown> = {}) {
      mockFlowCrypto.decryptRequest.mockReturnValue({
        decrypted: {
          version: '3.0',
          action: 'data_exchange',
          flow_token: 'tok',
          data: {
            action: 'send_to_address',
            address: 'TRawAddr0000000000001',
            network: 'TRON',
            asset: 'USDT',
            cryptoAmount: '5',
            saveAsBeneficiary: true,
            label: 'Mum',
            ...extra,
          },
        },
        aesKey: MOCK_AES_KEY,
        iv: MOCK_IV,
      });
    }

    function mockHappyProposal() {
      mockProposalService.createSendProposal.mockResolvedValue({
        proposalId: RAW_CONFIRMATION.proposalId,
        quoteId: null,
        confirmation: RAW_CONFIRMATION,
      });
    }

    it('calls createSendProposal with a raw_address descriptor built from the Flow data', async () => {
      makeSendToAddressBody();
      mockHappyProposal();

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockProposalService.createSendProposal).toHaveBeenCalledWith({
        userId: 'user-001',
        intent: {
          action: 'send_crypto',
          asset: 'USDT',
          cryptoAmount: '5',
          network: 'TRON',
        },
        destination: {
          kind: 'raw_address',
          address: 'TRawAddr0000000000001',
          network: 'TRON',
          save: { label: 'Mum' },
        },
      });
    });

    it('returns the itemized SEND_CONFIRM screen and never leaks internals', async () => {
      makeSendToAddressBody();
      mockHappyProposal();

      const result = await controller.handleFlow(
        makeEncryptedBody(),
        makeRes(),
      );

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({
        screen: 'SEND_CONFIRM',
        data: {
          proposalId: RAW_CONFIRMATION.proposalId,
          asset: 'USDT',
          cryptoAmount: '5',
          network: 'TRON',
          networkFeeCrypto: '1',
          totalDebit: '6',
          toAddressMasked: 'TRawAd...0001',
        },
      });
      // The full unmasked address must never appear in the response.
      expect(JSON.stringify(encryptedWith)).not.toContain(
        'TRawAddr0000000000001',
      );
      expect(result).toBe(ENCRYPTED_SENTINEL);
    });

    it('omits `save` on the descriptor when saveAsBeneficiary is not set', async () => {
      makeSendToAddressBody({ saveAsBeneficiary: undefined, label: undefined });
      mockHappyProposal();

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockProposalService.createSendProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: {
            kind: 'raw_address',
            address: 'TRawAddr0000000000001',
            network: 'TRON',
          },
        }),
      );
    });

    it('maps InvalidSendAddressError to an ERROR screen (never a 5xx)', async () => {
      makeSendToAddressBody();
      mockProposalService.createSendProposal.mockRejectedValue(
        new InvalidSendAddressError('TRawAddr0000000000001', 'TRON'),
      );

      const result = await controller.handleFlow(
        makeEncryptedBody(),
        makeRes(),
      );

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'ERROR' });
      const data = encryptedWith.data as Record<string, unknown>;
      expect(String(data.message)).toMatch(/valid.*TRON.*address/i);
      expect(JSON.stringify(encryptedWith)).not.toContain(
        'TRawAddr0000000000001',
      );
      expect(result).toBe(ENCRYPTED_SENTINEL);
    });

    it('maps SanctionsBlockedError to an ERROR screen with a distinct message', async () => {
      makeSendToAddressBody();
      mockProposalService.createSendProposal.mockRejectedValue(
        new SanctionsBlockedError(
          'TRawAddr0000000000001',
          'ofac',
          'evt-1',
          'evt-1',
        ),
      );

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'ERROR' });
      const data = encryptedWith.data as Record<string, unknown>;
      expect(String(data.message)).toMatch(
        /can.t be completed|different recipient/i,
      );
      expect(JSON.stringify(encryptedWith)).not.toContain('ofac');
      expect(JSON.stringify(encryptedWith)).not.toContain('evt-1');
    });

    it('maps SelfSendError to an ERROR screen with a distinct message', async () => {
      makeSendToAddressBody();
      mockProposalService.createSendProposal.mockRejectedValue(
        new SelfSendError(),
      );

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'ERROR' });
      const data = encryptedWith.data as Record<string, unknown>;
      expect(String(data.message)).toMatch(/own wallet address/i);
    });

    it('returns ERROR and does not call createSendProposal when the address is missing', async () => {
      makeSendToAddressBody({ address: undefined });

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockProposalService.createSendProposal).not.toHaveBeenCalled();
      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'ERROR' });
    });

    it('does not call executeBuy/executeSell/executeSend for this action', async () => {
      makeSendToAddressBody();
      mockHappyProposal();

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockExecutionService.executeBuy).not.toHaveBeenCalled();
      expect(mockExecutionService.executeSell).not.toHaveBeenCalled();
      expect(mockExecutionService.executeSend).not.toHaveBeenCalled();
    });
  });

  // ── W1: dispatch by proposal type ─────────────────────────────────────────

  describe('(W1) data_exchange dispatches by proposal type', () => {
    const TOKEN = 'valid.token';

    function makeDataExchangeBody(pin = 'pin-test', nonce = 'nonce-test') {
      mockFlowCrypto.decryptRequest.mockReturnValue({
        decrypted: {
          version: '3.0',
          action: 'data_exchange',
          flow_token: TOKEN,
          data: { pin, nonce },
        },
        aesKey: MOCK_AES_KEY,
        iv: MOCK_IV,
      });
    }

    it('(W1) sell proposal → executeSell called, NOT executeBuy, SUCCESS screen with providerRef', async () => {
      mockProposalRepository.getType.mockResolvedValue('sell');
      makeDataExchangeBody();

      const sellResult = {
        transactionId: 'txn-sell-001',
        status: 'settling' as const,
        payout: { providerRef: 'flw-payout-ref-001' },
      };
      mockExecutionService.executeSell.mockResolvedValue(sellResult);

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockExecutionService.executeSell).toHaveBeenCalledWith({
        userId: 'user-001',
        proposalId: 'prop-abc',
        directiveId: 'dir-xyz',
        nonce: 'nonce-test',
        pin: 'pin-test',
        idempotencyKey: 'prop-abc',
      });
      expect(mockExecutionService.executeBuy).not.toHaveBeenCalled();
      expect(mockExecutionService.executeSend).not.toHaveBeenCalled();

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'SUCCESS' });
    });

    it('(W1) send proposal → executeSend called, NOT executeBuy, SUCCESS screen with txRef', async () => {
      mockProposalRepository.getType.mockResolvedValue('send');
      makeDataExchangeBody();

      const sendResult = {
        transactionId: 'txn-send-001',
        status: 'settling' as const,
        onChain: { providerRef: 'blockradar-ref-001' },
      };
      mockExecutionService.executeSend.mockResolvedValue(sendResult);

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockExecutionService.executeSend).toHaveBeenCalledWith({
        userId: 'user-001',
        proposalId: 'prop-abc',
        directiveId: 'dir-xyz',
        nonce: 'nonce-test',
        pin: 'pin-test',
        idempotencyKey: 'prop-abc',
      });
      expect(mockExecutionService.executeBuy).not.toHaveBeenCalled();
      expect(mockExecutionService.executeSell).not.toHaveBeenCalled();

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'SUCCESS' });
    });

    it('(W1) buy proposal → executeBuy called (unchanged behaviour)', async () => {
      mockProposalRepository.getType.mockResolvedValue('buy');
      makeDataExchangeBody();

      const buyResult = {
        transactionId: 'txn-buy-001',
        status: 'settling' as const,
        payment: {
          accountNumber: 'ACCT-001',
          bankName: 'Test Bank',
          providerRef: 'ref-001',
          amount: '5000',
          currency: 'NGN' as const,
        },
      };
      mockExecutionService.executeBuy.mockResolvedValue(buyResult);

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockExecutionService.executeBuy).toHaveBeenCalledWith({
        userId: 'user-001',
        proposalId: 'prop-abc',
        directiveId: 'dir-xyz',
        nonce: 'nonce-test',
        pin: 'pin-test',
        idempotencyKey: 'prop-abc',
      });
      expect(mockExecutionService.executeSell).not.toHaveBeenCalled();
      expect(mockExecutionService.executeSend).not.toHaveBeenCalled();

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'SUCCESS' });
    });

    it('(W1) unknown proposal type → ERROR screen', async () => {
      mockProposalRepository.getType.mockResolvedValue('swap');
      makeDataExchangeBody();

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      expect(mockExecutionService.executeBuy).not.toHaveBeenCalled();
      expect(mockExecutionService.executeSell).not.toHaveBeenCalled();
      expect(mockExecutionService.executeSend).not.toHaveBeenCalled();

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'ERROR' });
    });

    it('(W1) proposal not found (getType returns null) → ERROR screen', async () => {
      mockProposalRepository.getType.mockResolvedValue(null);
      makeDataExchangeBody();

      await controller.handleFlow(makeEncryptedBody(), makeRes());

      const encryptedWith = captureEncryptArg(mockFlowCrypto.encryptResponse);
      expect(encryptedWith).toMatchObject({ screen: 'ERROR' });
    });
  });
});
