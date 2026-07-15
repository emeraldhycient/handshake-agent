/**
 * Unit tests for ProposalController and TransactionStatusController.
 *
 * TDD: tests cover ownership checks, status guards, type dispatch,
 * domain-error-to-HTTP mapping, and the transaction status endpoint.
 *
 * Run with: pnpm --filter @handshake-agent/api test -- --testPathPattern=proposal.controller
 */

import {
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  UnprocessableEntityException,
  ForbiddenException,
  BadGatewayException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  ProposalController,
  TransactionStatusController,
} from './proposal.controller';
import { JwtAuthGuard } from '../../auth/presentation/jwt-auth.guard';

import { PROPOSAL_REPOSITORY } from '../../transactions/application/ports/proposal.repository.port';
import { TRANSACTION_REPOSITORY } from '../../transactions/application/ports/transaction.repository.port';
import { SETTLEMENT_REPOSITORY } from '../../transactions/application/ports/settlement.repository.port';
import { DirectiveService } from '../../transactions/application/directive.service';
import { ExecutionService } from '../../transactions/application/execution.service';

import { PinInvalidError } from '../../../core/auth/domain/pin-errors';
import {
  DirectiveExpiredError,
  DirectiveReplayError,
  DirectiveSignatureError,
} from '../../transactions/domain/directive-errors';
import {
  ProposalExpiredError,
  ProposalNotExecutableError,
  QuoteDriftError,
  ProviderUnavailableError,
  InsufficientBalanceError,
  SwapUnavailableError,
} from '../../transactions/domain/execution-errors';
import { KycNotVerifiedError } from '../../identity/domain/gate-errors';
import { BeneficiaryCoolingOffError } from '../../beneficiaries/domain/beneficiary-errors';
import { SanctionsBlockedError } from '../../compliance/domain/compliance-errors';
import { SessionService } from '../../../core/auth/session.service';

// ---------------------------------------------------------------------------
// Fake providers
// ---------------------------------------------------------------------------

const makeProposal = (
  overrides: Partial<{
    id: string;
    userId: string;
    status: string;
    type: string;
    expiresAt: Date;
  }> = {},
) => ({
  id: 'proposal-uuid',
  userId: 'user-uuid',
  conversationId: null,
  type: 'buy',
  status: 'pending',
  parameters: {},
  parametersChecksum: 'abc',
  quoteId: null,
  expiresAt: new Date(Date.now() + 60_000), // 1 min from now
  confirmedAt: null,
  createdAt: new Date(),
  ...overrides,
});

const makeTransaction = (
  overrides: Partial<{
    id: string;
    userId: string;
    status: string;
    type: string;
    metadata: Record<string, unknown>;
  }> = {},
) => ({
  id: 'txn-uuid',
  proposalId: 'proposal-uuid',
  userId: 'user-uuid',
  type: 'buy',
  status: 'settling',
  idempotencyKey: 'idem-key',
  requestChecksum: 'cs',
  fxRateSnapshot: null,
  metadata: {
    accountNumber: '1234567890',
    bankName: 'Test Bank',
    providerRef: 'flw-ref-001',
    fiatAmount: '10000',
    fiatCurrency: 'NGN',
    asset: 'USDT',
    cryptoAmount: '6.5',
  } as Record<string, unknown>,
  processorTxRef: null,
  pinVerifiedAt: null,
  createdAt: new Date(),
  ...overrides,
});

const mockProposalRepo = {
  findById: jest.fn(),
  getType: jest.fn(),
  create: jest.fn(),
  updateStatus: jest.fn(),
};

const mockTransactionRepo = {
  findById: jest.fn(),
  findByUserId: jest.fn(),
  findByIdempotencyKey: jest.fn(),
  create: jest.fn(),
  createSettlingWithProposal: jest.fn(),
  updateStatus: jest.fn(),
  mergeMetadata: jest.fn(),
};

const mockSettlementRepo = {
  findReceiptNumber: jest.fn(),
};

const mockDirectiveService = {
  issue: jest.fn(),
  consume: jest.fn(),
};

const mockExecutionService = {
  executeBuy: jest.fn(),
  executeSell: jest.fn(),
  executeSend: jest.fn(),
  executeSwap: jest.fn(),
  executeInternalTransfer: jest.fn(),
};

const mockSessionService = {
  findDeviceIdByFingerprint: jest.fn(),
};

// ---------------------------------------------------------------------------
// Test user
// ---------------------------------------------------------------------------

const TEST_USER = {
  userId: 'user-uuid',
  sessionId: 'sess-uuid',
  deviceId: null,
};

// ---------------------------------------------------------------------------
// Module setup
// ---------------------------------------------------------------------------

async function buildModule(): Promise<TestingModule> {
  return (
    Test.createTestingModule({
      controllers: [ProposalController, TransactionStatusController],
      providers: [
        { provide: PROPOSAL_REPOSITORY, useValue: mockProposalRepo },
        { provide: TRANSACTION_REPOSITORY, useValue: mockTransactionRepo },
        { provide: SETTLEMENT_REPOSITORY, useValue: mockSettlementRepo },
        { provide: DirectiveService, useValue: mockDirectiveService },
        { provide: ExecutionService, useValue: mockExecutionService },
        { provide: SessionService, useValue: mockSessionService },
      ],
    })
      // JwtAuthGuard has its own dependencies (TokenService, IAuthSessionRepository).
      // Override it to always allow in unit tests — guard behaviour is tested separately.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile()
  );
}

// ---------------------------------------------------------------------------
// ProposalController — authorize
// ---------------------------------------------------------------------------

describe('ProposalController.authorize', () => {
  let controller: ProposalController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    controller = module.get(ProposalController);
  });

  it('throws 404 when proposal is not found', async () => {
    mockProposalRepo.findById.mockResolvedValue(null);

    await expect(controller.authorize('missing-id', TEST_USER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws 404 when proposal belongs to a different user', async () => {
    mockProposalRepo.findById.mockResolvedValue(
      makeProposal({ userId: 'other-user' }),
    );

    await expect(
      controller.authorize('proposal-uuid', TEST_USER),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws 409 when proposal status is "executed"', async () => {
    mockProposalRepo.findById.mockResolvedValue(
      makeProposal({ status: 'executed' }),
    );

    await expect(
      controller.authorize('proposal-uuid', TEST_USER),
    ).rejects.toThrow(ConflictException);
  });

  it('throws 409 when proposal is expired', async () => {
    mockProposalRepo.findById.mockResolvedValue(
      makeProposal({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(
      controller.authorize('proposal-uuid', TEST_USER),
    ).rejects.toThrow(ConflictException);
  });

  it('uses request_pin ref for buy proposals', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'buy' }));
    mockProposalRepo.getType.mockResolvedValue('buy');
    mockDirectiveService.issue.mockResolvedValue({
      directiveId: 'dir-uuid',
      nonce: 'abc123',
      expiresAt: new Date(),
    });

    await controller.authorize('proposal-uuid', TEST_USER);

    expect(mockDirectiveService.issue).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'request_pin' }),
    );
  });

  it('uses request_pin ref for sell proposals', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'sell' }));
    mockDirectiveService.issue.mockResolvedValue({
      directiveId: 'dir-uuid',
      nonce: 'abc123',
      expiresAt: new Date(),
    });

    await controller.authorize('proposal-uuid', TEST_USER);

    expect(mockDirectiveService.issue).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'request_pin' }),
    );
  });

  it('uses request_step_up ref for send proposals', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'send' }));
    mockProposalRepo.getType.mockResolvedValue('send');
    mockDirectiveService.issue.mockResolvedValue({
      directiveId: 'dir-uuid',
      nonce: 'abc123',
      expiresAt: new Date(),
    });

    await controller.authorize('proposal-uuid', TEST_USER);

    expect(mockDirectiveService.issue).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'request_step_up' }),
    );
  });

  it('uses request_step_up ref for internal_transfer proposals', async () => {
    mockProposalRepo.findById.mockResolvedValue(
      makeProposal({ type: 'internal_transfer' }),
    );
    mockProposalRepo.getType.mockResolvedValue('internal_transfer');
    mockDirectiveService.issue.mockResolvedValue({
      directiveId: 'dir-uuid',
      nonce: 'abc123',
      expiresAt: new Date(),
    });

    await controller.authorize('proposal-uuid', TEST_USER);

    expect(mockDirectiveService.issue).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'request_step_up' }),
    );
  });

  it('returns AuthorizeProposalResponse with ISO expiresAt', async () => {
    const expiresAt = new Date('2026-01-01T00:00:00.000Z');
    mockProposalRepo.findById.mockResolvedValue(makeProposal());
    mockProposalRepo.getType.mockResolvedValue('buy');
    mockDirectiveService.issue.mockResolvedValue({
      directiveId: 'dir-uuid',
      nonce: 'abc123',
      expiresAt,
    });

    const result = await controller.authorize('proposal-uuid', TEST_USER);

    expect(result).toEqual({
      directiveId: 'dir-uuid',
      nonce: 'abc123',
      expiresAt: expiresAt.toISOString(),
    });
  });
});

// ---------------------------------------------------------------------------
// ProposalController — execute
// ---------------------------------------------------------------------------

describe('ProposalController.execute', () => {
  let controller: ProposalController;

  const validBody = {
    directiveId: 'dir-uuid',
    nonce: 'abc123',
    pin: '1234',
    idempotencyKey: 'idem-uuid',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    controller = module.get(ProposalController);
  });

  it('throws 404 when proposal ownership check fails', async () => {
    mockProposalRepo.findById.mockResolvedValue(null);

    await expect(
      controller.execute('missing-id', validBody as never, TEST_USER),
    ).rejects.toThrow(NotFoundException);
  });

  it('dispatches buy and returns payment details', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'buy' }));
    mockProposalRepo.getType.mockResolvedValue('buy');
    mockExecutionService.executeBuy.mockResolvedValue({
      transactionId: 'txn-uuid',
      status: 'settling',
      payment: {
        accountNumber: '1234567890',
        bankName: 'Test Bank',
        providerRef: 'flw-ref',
        amount: '10000',
        currency: 'NGN',
      },
    });

    const result = await controller.execute(
      'proposal-uuid',
      validBody,
      TEST_USER,
    );

    expect(mockExecutionService.executeBuy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_USER.userId,
        proposalId: 'proposal-uuid',
        directiveId: validBody.directiveId,
        nonce: validBody.nonce,
        pin: validBody.pin,
        // I8: the engine receives the stable per-proposal key, not the body key.
        idempotencyKey: 'proposal-uuid',
      }),
    );
    expect(result.transactionId).toBe('txn-uuid');
    expect(result.payment).toBeDefined();
  });

  it('I8: uses a STABLE per-proposal idempotency key (proposalId), ignoring the client body key, so a retry cannot double-execute', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'buy' }));
    mockExecutionService.executeBuy.mockResolvedValue({
      transactionId: 'txn-uuid',
      status: 'settling',
      payment: {
        accountNumber: '1',
        bankName: 'b',
        providerRef: 'r',
        amount: '1',
        currency: 'NGN',
      },
    });

    // Two confirm attempts for the SAME proposal, each carrying a DIFFERENT
    // client-supplied key — exactly the web bug: the FE mints a fresh uuid per
    // confirm AND the axios interceptor stamps a fresh Idempotency-Key header,
    // so the prior body-keyed dedup never fired and both attempts executed.
    await controller.execute(
      'proposal-uuid',
      { ...validBody, idempotencyKey: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      TEST_USER,
    );
    await controller.execute(
      'proposal-uuid',
      { ...validBody, idempotencyKey: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      TEST_USER,
    );

    // Both attempts must reach the engine with the SAME stable key (= proposalId,
    // matching the WhatsApp surface) so the engine's findByIdempotencyKey dedups
    // the second attempt instead of creating a second real-money transaction.
    expect(mockExecutionService.executeBuy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        proposalId: 'proposal-uuid',
        idempotencyKey: 'proposal-uuid',
      }),
    );
    expect(mockExecutionService.executeBuy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        proposalId: 'proposal-uuid',
        idempotencyKey: 'proposal-uuid',
      }),
    );
  });

  it('dispatches sell and returns payout', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'sell' }));
    mockProposalRepo.getType.mockResolvedValue('sell');
    mockExecutionService.executeSell.mockResolvedValue({
      transactionId: 'txn-uuid',
      status: 'settling',
      payout: { providerRef: 'flw-transfer-001' },
    });

    const result = await controller.execute(
      'proposal-uuid',
      validBody,
      TEST_USER,
    );

    expect(result.payout).toEqual({ providerRef: 'flw-transfer-001' });
  });

  it('maps sell InsufficientBalanceError → 422', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'sell' }));
    mockExecutionService.executeSell.mockRejectedValue(
      new InsufficientBalanceError('1.0', '5.0', 'USDT'),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('dispatches send (resolving deviceFingerprint→deviceId) and returns onChain', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'send' }));
    mockSessionService.findDeviceIdByFingerprint.mockResolvedValue(
      'device-uuid',
    );
    mockExecutionService.executeSend.mockResolvedValue({
      transactionId: 'txn-send',
      status: 'settling',
      onChain: { providerRef: 'blockradar-ref-001' },
    });

    const sendBody = { ...validBody, deviceFingerprint: 'web-fp-1' };
    const result = await controller.execute(
      'proposal-uuid',
      sendBody,
      TEST_USER,
    );

    expect(mockSessionService.findDeviceIdByFingerprint).toHaveBeenCalledWith(
      TEST_USER.userId,
      'web-fp-1',
    );
    expect(mockExecutionService.executeSend).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_USER.userId,
        proposalId: 'proposal-uuid',
        directiveId: validBody.directiveId,
        nonce: validBody.nonce,
        pin: validBody.pin,
        idempotencyKey: validBody.idempotencyKey,
        deviceId: 'device-uuid',
      }),
    );
    expect(result.transactionId).toBe('txn-send');
    expect(result.onChain).toEqual({ providerRef: 'blockradar-ref-001' });
  });

  it('passes deviceId undefined for send when fingerprint resolves to no device', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'send' }));
    mockSessionService.findDeviceIdByFingerprint.mockResolvedValue(null);
    mockExecutionService.executeSend.mockResolvedValue({
      transactionId: 'txn-send',
      status: 'settling',
      onChain: { providerRef: 'blockradar-ref-001' },
    });

    await controller.execute('proposal-uuid', validBody, TEST_USER);

    expect(mockExecutionService.executeSend).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: undefined }),
    );
  });

  it('dispatches internal_transfer (idempotencyKey=proposalId, resolving device) and returns status', async () => {
    mockProposalRepo.findById.mockResolvedValue(
      makeProposal({ type: 'internal_transfer' }),
    );
    mockSessionService.findDeviceIdByFingerprint.mockResolvedValue(
      'device-uuid',
    );
    mockExecutionService.executeInternalTransfer.mockResolvedValue({
      transactionId: 'txn-transfer',
      status: 'completed',
      receiptNumber: 'HS-2026-000001',
      senderBalanceAfter: '90',
      recipientBalanceAfter: '10',
      recipientUserId: 'recipient-uuid',
    });

    const transferBody = { ...validBody, deviceFingerprint: 'web-fp-1' };
    const result = await controller.execute(
      'proposal-uuid',
      transferBody,
      TEST_USER,
    );

    expect(mockSessionService.findDeviceIdByFingerprint).toHaveBeenCalledWith(
      TEST_USER.userId,
      'web-fp-1',
    );
    expect(mockExecutionService.executeInternalTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_USER.userId,
        proposalId: 'proposal-uuid',
        directiveId: validBody.directiveId,
        nonce: validBody.nonce,
        pin: validBody.pin,
        // I8: idempotencyKey = proposalId (NOT the client-supplied body key).
        idempotencyKey: 'proposal-uuid',
        deviceId: 'device-uuid',
      }),
    );
    expect(result.transactionId).toBe('txn-transfer');
    expect(result.status).toBe('completed');
  });

  it('maps send InsufficientBalanceError → 422', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'send' }));
    mockSessionService.findDeviceIdByFingerprint.mockResolvedValue(null);
    mockExecutionService.executeSend.mockRejectedValue(
      new InsufficientBalanceError('1.0', '5.0', 'USDT'),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('maps send BeneficiaryCoolingOffError → 422', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'send' }));
    mockSessionService.findDeviceIdByFingerprint.mockResolvedValue(null);
    mockExecutionService.executeSend.mockRejectedValue(
      new BeneficiaryCoolingOffError('ben-1', new Date(Date.now() + 60_000)),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('maps send SanctionsBlockedError → 403', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'send' }));
    mockSessionService.findDeviceIdByFingerprint.mockResolvedValue(null);
    mockExecutionService.executeSend.mockRejectedValue(
      new SanctionsBlockedError('Taddr', 'flagged', 'evt-1', 'ref-1'),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(ForbiddenException);
  });

  it('maps PinInvalidError to 401', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal());
    mockProposalRepo.getType.mockResolvedValue('buy');
    mockExecutionService.executeBuy.mockRejectedValue(new PinInvalidError(2));

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('maps DirectiveExpiredError to 401', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal());
    mockProposalRepo.getType.mockResolvedValue('buy');
    mockExecutionService.executeBuy.mockRejectedValue(
      new DirectiveExpiredError(),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('maps DirectiveReplayError to 401', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal());
    mockProposalRepo.getType.mockResolvedValue('buy');
    mockExecutionService.executeBuy.mockRejectedValue(
      new DirectiveReplayError(),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('maps DirectiveSignatureError to 401', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal());
    mockProposalRepo.getType.mockResolvedValue('buy');
    mockExecutionService.executeBuy.mockRejectedValue(
      new DirectiveSignatureError('bad'),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('maps QuoteDriftError to 422', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal());
    mockProposalRepo.getType.mockResolvedValue('buy');
    mockExecutionService.executeBuy.mockRejectedValue(
      new QuoteDriftError(150, 100),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('maps ProposalExpiredError to 422', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal());
    mockProposalRepo.getType.mockResolvedValue('buy');
    mockExecutionService.executeBuy.mockRejectedValue(
      new ProposalExpiredError(),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('maps ProposalNotExecutableError to 409', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal());
    mockProposalRepo.getType.mockResolvedValue('buy');
    mockExecutionService.executeBuy.mockRejectedValue(
      new ProposalNotExecutableError('bad state'),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(ConflictException);
  });

  it('maps KycNotVerifiedError to 403', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal());
    mockProposalRepo.getType.mockResolvedValue('buy');
    mockExecutionService.executeBuy.mockRejectedValue(
      new KycNotVerifiedError('status'),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(ForbiddenException);
  });

  it('maps ProviderUnavailableError to 502 (clear message, not a raw 500)', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal());
    mockProposalRepo.getType.mockResolvedValue('buy');
    mockExecutionService.executeBuy.mockRejectedValue(
      new ProviderUnavailableError('createCollection'),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(BadGatewayException);
  });

  // ── swap dispatch ──────────────────────────────────────────────────────────

  it('dispatches swap → executeSwap and returns swap providerSwapId', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'swap' }));
    mockExecutionService.executeSwap.mockResolvedValue({
      transactionId: 'txn-swap-1',
      status: 'settling',
      swap: { providerSwapId: 'blockradar-swap-001' },
    });

    const result = await controller.execute(
      'proposal-uuid',
      validBody,
      TEST_USER,
    );

    expect(mockExecutionService.executeSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_USER.userId,
        proposalId: 'proposal-uuid',
        idempotencyKey: 'proposal-uuid',
        directiveId: validBody.directiveId,
        nonce: validBody.nonce,
        pin: validBody.pin,
      }),
    );
    expect(result.transactionId).toBe('txn-swap-1');
    expect(result.status).toBe('settling');
    expect(
      (result as { swap?: { providerSwapId: string } }).swap?.providerSwapId,
    ).toBe('blockradar-swap-001');
  });

  it('swap: maps ProviderUnavailableError → 502', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'swap' }));
    mockExecutionService.executeSwap.mockRejectedValue(
      new ProviderUnavailableError('swapExecute'),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(BadGatewayException);
  });

  it('swap: maps InsufficientBalanceError → 422', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'swap' }));
    mockExecutionService.executeSwap.mockRejectedValue(
      new InsufficientBalanceError('1.0', '10.0', 'USDT'),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('swap: maps SwapUnavailableError → 422 (non-retryable, NOT a retryable 502)', async () => {
    // A swap that the provider cannot execute (e.g. not enrolled / 404) is a
    // permanent condition. It must surface as a graceful non-retryable error, not
    // a retryable BadGateway that invites the user to keep tapping Confirm.
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'swap' }));
    mockExecutionService.executeSwap.mockRejectedValue(
      new SwapUnavailableError(),
    );

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.not.toThrow(BadGatewayException);
  });
});

// ---------------------------------------------------------------------------
// TransactionStatusController
// ---------------------------------------------------------------------------

describe('TransactionStatusController', () => {
  let controller: TransactionStatusController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await buildModule();
    controller = module.get(TransactionStatusController);
  });

  it('throws 404 when transaction is not found', async () => {
    mockTransactionRepo.findById.mockResolvedValue(null);

    await expect(controller.getStatus('missing-id', TEST_USER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws 404 when transaction belongs to a different user', async () => {
    mockTransactionRepo.findById.mockResolvedValue(
      makeTransaction({ userId: 'other-user' }),
    );

    await expect(controller.getStatus('txn-uuid', TEST_USER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns 200 with payment details when status is settling', async () => {
    mockTransactionRepo.findById.mockResolvedValue(makeTransaction());

    const result = await controller.getStatus('txn-uuid', TEST_USER);

    expect(result.id).toBe('txn-uuid');
    expect(result.status).toBe('settling');
    expect(result.payment).toEqual({
      accountNumber: '1234567890',
      bankName: 'Test Bank',
      providerRef: 'flw-ref-001',
      amount: '10000',
      currency: 'NGN',
    });
    expect(result.receiptNumber).toBeUndefined();
    // findReceiptNumber should NOT be called for a non-completed transaction
    expect(mockSettlementRepo.findReceiptNumber).not.toHaveBeenCalled();
  });

  it('returns receiptNumber when status is completed', async () => {
    mockTransactionRepo.findById.mockResolvedValue(
      makeTransaction({ status: 'completed' }),
    );
    mockSettlementRepo.findReceiptNumber.mockResolvedValue('HS-2026-000001');

    const result = await controller.getStatus('txn-uuid', TEST_USER);

    expect(result.status).toBe('completed');
    expect(result.receiptNumber).toBe('HS-2026-000001');
    expect(mockSettlementRepo.findReceiptNumber).toHaveBeenCalledWith(
      'txn-uuid',
    );
  });

  it('omits receiptNumber when status is completed but receipt not yet minted', async () => {
    mockTransactionRepo.findById.mockResolvedValue(
      makeTransaction({ status: 'completed' }),
    );
    mockSettlementRepo.findReceiptNumber.mockResolvedValue(null);

    const result = await controller.getStatus('txn-uuid', TEST_USER);

    expect(result.receiptNumber).toBeUndefined();
  });

  it('includes asset and cryptoAmount in the response', async () => {
    mockTransactionRepo.findById.mockResolvedValue(makeTransaction());

    const result = await controller.getStatus('txn-uuid', TEST_USER);

    expect(result.asset).toBe('USDT');
    expect(result.cryptoAmount).toBe('6.5');
    expect(result.fiatAmount).toBe('10000');
    expect(result.fiatCurrency).toBe('NGN');
  });

  it('omits payment when metadata has no accountNumber', async () => {
    mockTransactionRepo.findById.mockResolvedValue(
      makeTransaction({
        metadata: { asset: 'USDT', fiatAmount: '5000' },
      }),
    );

    const result = await controller.getStatus('txn-uuid', TEST_USER);

    expect(result.payment).toBeUndefined();
  });

  // ── New full-detail fields ─────────────────────────────────────────────────

  it('returns direction=in for a deposit (buy) transaction', async () => {
    mockTransactionRepo.findById.mockResolvedValue(
      makeTransaction({ type: 'buy' }),
    );

    const result = await controller.getStatus('txn-uuid', TEST_USER);

    expect(result.direction).toBe('in');
  });

  it('returns direction=out for a sell transaction', async () => {
    mockTransactionRepo.findById.mockResolvedValue(
      makeTransaction({
        type: 'sell',
        metadata: { asset: 'USDT', fiatAmount: '8000', fiatCurrency: 'NGN' },
      }),
    );

    const result = await controller.getStatus('txn-uuid', TEST_USER);

    expect(result.direction).toBe('out');
  });

  it('returns txHash, blockNumber, confirmations, network, and counterparty from metadata', async () => {
    mockTransactionRepo.findById.mockResolvedValue(
      makeTransaction({
        type: 'deposit',
        metadata: {
          asset: 'USDT',
          cryptoAmount: '12.00',
          network: 'tron',
          txHash: 'abc123def456',
          blockNumber: 68_421_042,
          confirmations: 21,
          senderAddress: 'TQn9YgkXgk7r',
          fees: '0.00 USDT',
        },
      }),
    );

    const result = await controller.getStatus('txn-uuid', TEST_USER);

    expect(result.network).toBe('tron');
    expect(result.txHash).toBe('abc123def456');
    expect(result.blockNumber).toBe(68_421_042);
    expect(result.confirmations).toBe(21);
    expect(result.counterparty).toBe('TQn9YgkXgk7r');
    expect(result.fees).toBe('0.00 USDT');
  });

  it('uses destination as counterparty for send transactions', async () => {
    mockTransactionRepo.findById.mockResolvedValue(
      makeTransaction({
        type: 'send',
        metadata: {
          asset: 'USDT',
          cryptoAmount: '26.00',
          network: 'tron',
          destination: 'TXyzABCDEFGH',
          txHash: 'send-hash-001',
        },
      }),
    );

    const result = await controller.getStatus('txn-uuid', TEST_USER);

    expect(result.counterparty).toBe('TXyzABCDEFGH');
    expect(result.txHash).toBe('send-hash-001');
  });

  it('uses the recipient @handle as counterparty for an internal_transfer (direction out)', async () => {
    // Internal-transfer metadata has no address/destination — only the
    // audit-snapshot recipientHandle. The projection must fall back to it so
    // the settled transfer shows the recipient, mirroring the MCP surface.
    mockTransactionRepo.findById.mockResolvedValue(
      makeTransaction({
        type: 'internal_transfer',
        status: 'completed',
        metadata: {
          asset: 'USDT',
          cryptoAmount: '3.00',
          recipientUserId: 'recipient-user-2',
          recipientHandle: '@ada',
        },
      }),
    );
    mockSettlementRepo.findReceiptNumber.mockResolvedValue('HS-2026-000009');

    const result = await controller.getStatus('txn-uuid', TEST_USER);

    expect(result.direction).toBe('out');
    expect(result.counterparty).toBe('@ada');
  });

  it('uses the recipient-row metadata.direction=in + senderHandle counterparty for an incoming internal_transfer', async () => {
    // The RECIPIENT-side internal_transfer row snapshots direction:'in' and the
    // SENDER's @handle — the projection must honour the per-row direction (not
    // the type map, which would force 'out') and fall back to senderHandle.
    mockTransactionRepo.findById.mockResolvedValue(
      makeTransaction({
        type: 'internal_transfer',
        status: 'completed',
        metadata: {
          asset: 'USDT',
          cryptoAmount: '3.00',
          direction: 'in',
          role: 'recipient',
          senderUserId: 'sender-user-1',
          senderHandle: '@sam.pay',
        },
      }),
    );
    mockSettlementRepo.findReceiptNumber.mockResolvedValue(null);

    const result = await controller.getStatus('txn-uuid', TEST_USER);

    expect(result.direction).toBe('in');
    expect(result.counterparty).toBe('@sam.pay');
  });

  it('omits on-chain fields when not present in metadata', async () => {
    mockTransactionRepo.findById.mockResolvedValue(
      makeTransaction({
        type: 'buy',
        metadata: {
          asset: 'USDT',
          fiatAmount: '5000',
          fiatCurrency: 'NGN',
          cryptoAmount: '4.5',
          accountNumber: '1234',
          bankName: 'Bank',
          providerRef: 'ref',
        },
      }),
    );

    const result = await controller.getStatus('txn-uuid', TEST_USER);

    expect(result.txHash).toBeUndefined();
    expect(result.blockNumber).toBeUndefined();
    expect(result.confirmations).toBeUndefined();
    expect(result.network).toBeUndefined();
    expect(result.fees).toBeUndefined();
    expect(result.counterparty).toBeUndefined();
  });

  it('list surfaces the recipient @handle as counterparty for an internal_transfer (lockstep with getStatus)', async () => {
    mockTransactionRepo.findByUserId.mockResolvedValue([
      makeTransaction({
        // The list response schema validates item.id as a uuid.
        id: 'aaaaaaaa-0000-7000-8000-000000000009',
        type: 'internal_transfer',
        status: 'completed',
        metadata: {
          asset: 'USDT',
          cryptoAmount: '3.00',
          recipientUserId: 'recipient-user-2',
          recipientHandle: '@ada',
        },
      }),
    ]);

    const result = await controller.list(TEST_USER);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].counterparty).toBe('@ada');
  });

  it('list carries the per-row direction: recipient internal_transfer → in (senderHandle counterparty), sender → out', async () => {
    mockTransactionRepo.findByUserId.mockResolvedValue([
      makeTransaction({
        id: 'aaaaaaaa-0000-7000-8000-00000000000a',
        type: 'internal_transfer',
        status: 'completed',
        metadata: {
          asset: 'USDT',
          cryptoAmount: '3.00',
          direction: 'in',
          role: 'recipient',
          senderHandle: '@sam.pay',
        },
      }),
      makeTransaction({
        id: 'aaaaaaaa-0000-7000-8000-00000000000b',
        type: 'internal_transfer',
        status: 'completed',
        metadata: {
          asset: 'USDT',
          cryptoAmount: '3.00',
          direction: 'out',
          role: 'sender',
          recipientHandle: '@ada',
        },
      }),
    ]);

    const result = await controller.list(TEST_USER);

    expect(result.items[0].direction).toBe('in');
    expect(result.items[0].counterparty).toBe('@sam.pay');
    expect(result.items[1].direction).toBe('out');
    expect(result.items[1].counterparty).toBe('@ada');
  });
});

// ---------------------------------------------------------------------------
// M1 — the money-movement execute route carries a strict per-window throttle.
// This is the PIN-verification route, so brute-force must be tightly bounded
// even though a global ThrottlerGuard already covers every endpoint.
// ---------------------------------------------------------------------------

describe('ProposalController.execute throttle (M1)', () => {
  it('has a strict @Throttle on the execute method (default throttler, <= 10/min)', () => {
    const handler = ProposalController.prototype.execute;

    // @Throttle emits metadata keyed `THROTTLER:LIMIT<name>` / `THROTTLER:TTL<name>`.
    const limit = Reflect.getMetadata(
      'THROTTLER:LIMITdefault',
      handler,
    ) as number;
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler) as number;

    expect(limit).toBeDefined();
    // Tight enough to blunt brute-force, loose enough for legitimate retries.
    expect(limit).toBeLessThanOrEqual(10);
    expect(limit).toBeGreaterThan(0);
    expect(ttl).toBe(60_000);
  });
});
