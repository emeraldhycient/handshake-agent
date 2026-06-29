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
} from '../../transactions/domain/execution-errors';
import { KycNotVerifiedError } from '../../identity/domain/gate-errors';

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
        idempotencyKey: validBody.idempotencyKey,
      }),
    );
    expect(result.transactionId).toBe('txn-uuid');
    expect(result.payment).toBeDefined();
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

  it('returns 422 for send (not yet supported on web)', async () => {
    mockProposalRepo.findById.mockResolvedValue(makeProposal({ type: 'send' }));
    mockProposalRepo.getType.mockResolvedValue('send');

    await expect(
      controller.execute('proposal-uuid', validBody as never, TEST_USER),
    ).rejects.toThrow(UnprocessableEntityException);
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
});
