/**
 * ProposalController — authorize and execute proposals from the web UI.
 *
 * POST /chat/proposals/:proposalId/authorize
 *   Mints a one-shot DirectiveGrant and returns { directiveId, nonce, expiresAt }.
 *   The nonce is forwarded by the client in the subsequent execute request.
 *
 * POST /chat/proposals/:proposalId/execute
 *   Redeems the directive, verifies the PIN, and dispatches to executeBuy / executeSell.
 *   Maps domain errors to the appropriate HTTP status codes.
 *
 * Security invariants preserved (CLAUDE.md §3.1 / §3.3):
 *   - JwtAuthGuard on every route — no unauthenticated access.
 *   - Ownership + status validation runs before any side-effecting call.
 *   - 404 is used for both "not found" and "wrong user" to avoid disclosing ownership.
 *   - The deterministic ExecutionService is the only component that creates Transactions.
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Inject,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';

import type {
  AuthorizeProposalResponse,
  ExecuteProposalResponse,
} from '@handshake-agent/contracts';

import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';

import {
  PROPOSAL_REPOSITORY,
  type IProposalRepository,
  type ProposalRecord,
} from '../../transactions/application/ports/proposal.repository.port';
import {
  TRANSACTION_REPOSITORY,
  type ITransactionRepository,
} from '../../transactions/application/ports/transaction.repository.port';
import {
  SETTLEMENT_REPOSITORY,
  type ISettlementRepository,
} from '../../transactions/application/ports/settlement.repository.port';
import { DirectiveService } from '../../transactions/application/directive.service';
import { ExecutionService } from '../../transactions/application/execution.service';

import {
  PinInvalidError,
  PinLockedError,
  PinNotSetError,
} from '../../../core/auth/domain/pin-errors';
import {
  DirectiveExpiredError,
  DirectiveReplayError,
  DirectiveProposalMismatchError,
  DirectiveSignatureError,
} from '../../transactions/domain/directive-errors';
import {
  ProposalExpiredError,
  ProposalNotExecutableError,
  QuoteDriftError,
} from '../../transactions/domain/execution-errors';
import {
  KycNotVerifiedError,
  TierLimitExceededError,
  VelocityExceededError,
  SimSwapBlockedError,
} from '../../identity/domain/gate-errors';

import { ExecuteProposalDto } from './dto/proposal.dto';

// The executable proposal statuses (must match the engine's own check).
const EXECUTABLE_STATUSES = new Set<string>(['pending', 'confirmed']);

@Controller('chat/proposals')
@UseGuards(JwtAuthGuard)
export class ProposalController {
  constructor(
    @Inject(PROPOSAL_REPOSITORY)
    private readonly proposalRepo: IProposalRepository,
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactionRepo: ITransactionRepository,
    @Inject(SETTLEMENT_REPOSITORY)
    private readonly settlementRepo: ISettlementRepository,
    private readonly directiveService: DirectiveService,
    private readonly executionService: ExecutionService,
  ) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Loads the proposal, validates ownership and executability.
   * Throws NotFoundException (never reveals ownership) or ConflictException.
   */
  private async loadExecutable(
    proposalId: string,
    userId: string,
  ): Promise<ProposalRecord> {
    const proposal = await this.proposalRepo.findById(proposalId);

    // Treat "not found" and "wrong user" the same to avoid ownership disclosure.
    if (proposal === null || proposal.userId !== userId) {
      throw new NotFoundException('Proposal not found');
    }

    if (
      !EXECUTABLE_STATUSES.has(proposal.status) ||
      proposal.expiresAt <= new Date()
    ) {
      throw new ConflictException('Proposal is not executable or has expired');
    }

    return proposal;
  }

  // ---------------------------------------------------------------------------
  // POST /chat/proposals/:proposalId/authorize
  // ---------------------------------------------------------------------------

  @Post(':proposalId/authorize')
  async authorize(
    @Param('proposalId') proposalId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AuthorizeProposalResponse> {
    await this.loadExecutable(proposalId, user.userId);

    const proposalType = await this.proposalRepo.getType(proposalId);
    // send requires a step-up directive; buy/sell use PIN.
    const ref = proposalType === 'send' ? 'request_step_up' : 'request_pin';

    const { directiveId, nonce, expiresAt } = await this.directiveService.issue(
      {
        proposalId,
        userId: user.userId,
        ref,
      },
    );

    return { directiveId, nonce, expiresAt: expiresAt.toISOString() };
  }

  // ---------------------------------------------------------------------------
  // POST /chat/proposals/:proposalId/execute
  // ---------------------------------------------------------------------------

  @Post(':proposalId/execute')
  async execute(
    @Param('proposalId') proposalId: string,
    @Body() body: ExecuteProposalDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExecuteProposalResponse> {
    await this.loadExecutable(proposalId, user.userId);

    const proposalType = await this.proposalRepo.getType(proposalId);

    try {
      if (proposalType === 'buy') {
        const result = await this.executionService.executeBuy({
          userId: user.userId,
          proposalId,
          directiveId: body.directiveId,
          nonce: body.nonce,
          pin: body.pin,
          idempotencyKey: body.idempotencyKey,
        });
        return {
          transactionId: result.transactionId,
          status: result.status,
          payment: result.payment,
        };
      }

      if (proposalType === 'sell') {
        const result = await this.executionService.executeSell({
          userId: user.userId,
          proposalId,
          directiveId: body.directiveId,
          nonce: body.nonce,
          pin: body.pin,
          idempotencyKey: body.idempotencyKey,
        });
        return {
          transactionId: result.transactionId,
          status: result.status,
          payout: { providerRef: result.payout.providerRef },
        };
      }

      // send via web is not yet supported (deviceId resolution is non-trivial
      // for the web surface — deferred; WhatsApp handles send flows).
      if (proposalType === 'send') {
        throw new UnprocessableEntityException(
          'send via web is not yet supported',
        );
      }

      // Unknown type — treat as unprocessable.
      throw new UnprocessableEntityException(
        `proposal type '${proposalType ?? 'unknown'}' is not executable via this endpoint`,
      );
    } catch (err) {
      // Re-throw NestJS HTTP exceptions untouched.
      if (
        err instanceof NotFoundException ||
        err instanceof ConflictException ||
        err instanceof UnauthorizedException ||
        err instanceof UnprocessableEntityException ||
        err instanceof ForbiddenException
      ) {
        throw err;
      }

      // PIN / directive auth errors → 401 (not leaking internal codes).
      if (
        err instanceof PinInvalidError ||
        err instanceof PinLockedError ||
        err instanceof PinNotSetError ||
        err instanceof DirectiveExpiredError ||
        err instanceof DirectiveReplayError ||
        err instanceof DirectiveProposalMismatchError ||
        err instanceof DirectiveSignatureError
      ) {
        throw new UnauthorizedException('Authorization failed');
      }

      // Quote expired or rate drifted too far → 422.
      if (
        err instanceof ProposalExpiredError ||
        err instanceof QuoteDriftError
      ) {
        throw new UnprocessableEntityException(
          err instanceof QuoteDriftError
            ? 'Quote has drifted; please re-quote and try again'
            : 'Proposal has expired',
        );
      }

      // Proposal in wrong state → 409.
      if (err instanceof ProposalNotExecutableError) {
        throw new ConflictException('Proposal is not executable');
      }

      // KYC / velocity / SIM-swap gate → 403.
      if (
        err instanceof KycNotVerifiedError ||
        err instanceof TierLimitExceededError ||
        err instanceof VelocityExceededError ||
        err instanceof SimSwapBlockedError
      ) {
        throw new ForbiddenException('Transaction not permitted');
      }

      // Unexpected errors bubble up to the global exception filter.
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // GET /chat/proposals/transactions/:id  — transaction status
  // (declared here to keep it in the same ChatModule; path is /chat/proposals/txn/:id)
  // ---------------------------------------------------------------------------
}

// ---------------------------------------------------------------------------
// Transaction Status Controller (separate class, same module)
// GET /transactions/:id
// ---------------------------------------------------------------------------

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionStatusController {
  constructor(
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactionRepo: ITransactionRepository,
    @Inject(SETTLEMENT_REPOSITORY)
    private readonly settlementRepo: ISettlementRepository,
  ) {}

  @Get(':id')
  async getStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const transaction = await this.transactionRepo.findById(id);

    if (transaction === null || transaction.userId !== user.userId) {
      throw new NotFoundException('Transaction not found');
    }

    const meta = transaction.metadata;

    // Build the payment sub-object from metadata if the fields are present.
    // These are persisted by executeBuy in the mergeMetadata call (step 8c).
    const payment =
      typeof meta.accountNumber === 'string'
        ? {
            accountNumber: meta.accountNumber,
            bankName: meta.bankName as string,
            providerRef: meta.providerRef as string,
            amount: meta.fiatAmount as string,
            currency: meta.fiatCurrency as string,
          }
        : undefined;

    let receiptNumber: string | undefined;
    if (transaction.status === 'completed') {
      const found = await this.settlementRepo.findReceiptNumber(id);
      receiptNumber = found ?? undefined;
    }

    return {
      id: transaction.id,
      type: transaction.type,
      status: transaction.status,
      ...(receiptNumber !== undefined ? { receiptNumber } : {}),
      ...(payment !== undefined ? { payment } : {}),
      ...(typeof meta.asset === 'string' ? { asset: meta.asset } : {}),
      ...(typeof meta.cryptoAmount === 'string'
        ? { cryptoAmount: meta.cryptoAmount }
        : {}),
      ...(typeof meta.fiatAmount === 'string'
        ? { fiatAmount: meta.fiatAmount }
        : {}),
      ...(typeof meta.fiatCurrency === 'string'
        ? { fiatCurrency: meta.fiatCurrency }
        : {}),
      createdAt: transaction.createdAt.toISOString(),
    };
  }
}
