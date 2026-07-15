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
  Query,
  Body,
  UseGuards,
  Inject,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
  UnprocessableEntityException,
  ForbiddenException,
  BadGatewayException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import type {
  AuthorizeProposalResponse,
  ExecuteProposalResponse,
  TransactionListResponse,
  TransactionStatusResponse,
} from '@handshake-agent/contracts';
import { TransactionListResponseSchema } from '@handshake-agent/contracts';

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
import { SessionService } from '../../../core/auth/session.service';

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
  ProviderUnavailableError,
  InsufficientBalanceError,
  SwapUnavailableError,
} from '../../transactions/domain/execution-errors';
import {
  KycNotVerifiedError,
  TierLimitExceededError,
  VelocityExceededError,
  SimSwapBlockedError,
} from '../../identity/domain/gate-errors';
import { BeneficiaryCoolingOffError } from '../../beneficiaries/domain/beneficiary-errors';
import { SanctionsBlockedError } from '../../compliance/domain/compliance-errors';

import { ExecuteProposalDto } from './dto/proposal.dto';

// Inflow transaction types — used to derive `direction` when not already in metadata.
const INFLOW_TYPES = new Set(['buy', 'deposit', 'receive', 'reward', 'refund']);

// The executable proposal statuses (must match the engine's own check).
const EXECUTABLE_STATUSES = new Set<string>(['pending', 'confirmed']);

// Pagination limits for GET /transactions
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

@Controller('chat/proposals')
@UseGuards(JwtAuthGuard)
export class ProposalController {
  constructor(
    @Inject(PROPOSAL_REPOSITORY)
    private readonly proposalRepo: IProposalRepository,
    private readonly directiveService: DirectiveService,
    private readonly executionService: ExecutionService,
    private readonly sessionService: SessionService,
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
    const proposal = await this.loadExecutable(proposalId, user.userId);

    // send + internal_transfer require a step-up directive (both are irreversible
    // value moves — §3.4); buy/sell/swap use PIN.
    const ref =
      proposal.type === 'send' || proposal.type === 'internal_transfer'
        ? 'request_step_up'
        : 'request_pin';

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

  // M1: strict per-window rate limit on the money-movement route. This is where
  // the PIN is verified, so brute-force must be tightly bounded — 10/min is safe
  // for legitimate retries (re-quote, wrong-PIN correction) but blunts scripted
  // guessing, on top of the app-wide ThrottlerGuard. Overrides the 'default'
  // named throttler's 60/min for this route only.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':proposalId/execute')
  async execute(
    @Param('proposalId') proposalId: string,
    @Body() body: ExecuteProposalDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExecuteProposalResponse> {
    const proposal = await this.loadExecutable(proposalId, user.userId);

    const proposalType = proposal.type;

    // I8: the execute idempotency key MUST be stable per proposal, not taken from
    // the request body. The web client mints a fresh uuid on every confirm attempt
    // AND the axios interceptor stamps a fresh Idempotency-Key header per request,
    // so a body-keyed dedup never fired — a retry created a SECOND real-money
    // transaction. Deriving the key from the (single-use) proposalId — exactly as
    // the WhatsApp flow surface does — makes retries collapse onto the engine's
    // findByIdempotencyKey check (at-most-once per proposal, §3.1 / NFR-7). The
    // client-supplied body.idempotencyKey is never trusted for this (§3.3).
    const idempotencyKey = proposalId;

    try {
      if (proposalType === 'buy') {
        const result = await this.executionService.executeBuy({
          userId: user.userId,
          proposalId,
          directiveId: body.directiveId,
          nonce: body.nonce,
          pin: body.pin,
          idempotencyKey,
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
          idempotencyKey,
        });
        return {
          transactionId: result.transactionId,
          status: result.status,
          payout: { providerRef: result.payout.providerRef },
        };
      }

      if (proposalType === 'send') {
        // Resolve the acting device from the client-supplied fingerprint so the
        // step-up is bound to it (§3.4). When the fingerprint matches no device
        // (or is absent), executeSend falls back to the user's pinned device.
        const deviceId =
          (await this.sessionService.findDeviceIdByFingerprint(
            user.userId,
            body.deviceFingerprint,
          )) ?? undefined;

        const result = await this.executionService.executeSend({
          userId: user.userId,
          proposalId,
          directiveId: body.directiveId,
          nonce: body.nonce,
          pin: body.pin,
          idempotencyKey: body.idempotencyKey,
          deviceId,
        });
        return {
          transactionId: result.transactionId,
          status: result.status,
          onChain: { providerRef: result.onChain.providerRef },
        };
      }

      if (proposalType === 'internal_transfer') {
        // Internal transfer uses step-up authorization (parity with send, §3.4).
        // Resolve the acting device from the client fingerprint so the step-up is
        // bound to it; falls back to the user's pinned device when unresolved.
        const deviceId =
          (await this.sessionService.findDeviceIdByFingerprint(
            user.userId,
            body.deviceFingerprint,
          )) ?? undefined;

        // idempotencyKey = proposalId (I8 at-most-once). The body-supplied key is
        // never trusted here — a retry must collapse onto the engine's
        // findByIdempotencyKey check, not mint a second real-money transfer.
        const result = await this.executionService.executeInternalTransfer({
          userId: user.userId,
          proposalId,
          directiveId: body.directiveId,
          nonce: body.nonce,
          pin: body.pin,
          idempotencyKey,
          deviceId,
        });
        return {
          transactionId: result.transactionId,
          status: result.status,
        };
      }

      if (proposalType === 'swap') {
        // Swap uses PIN authorization (same as buy/sell — no on-chain withdrawal
        // initiated by the user; the provider swaps within its own custody).
        // idempotencyKey is derived from proposalId for at-most-once (I8).
        const result = await this.executionService.executeSwap({
          userId: user.userId,
          proposalId,
          directiveId: body.directiveId,
          nonce: body.nonce,
          pin: body.pin,
          idempotencyKey,
        });
        return {
          transactionId: result.transactionId,
          status: result.status,
          swap: { providerSwapId: result.swap.providerSwapId },
        };
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

      // Insufficient crypto balance (sell/send) or beneficiary still in its
      // first-use cooling-off window (send) → 422 with the engine's message.
      if (
        err instanceof InsufficientBalanceError ||
        err instanceof BeneficiaryCoolingOffError
      ) {
        throw new UnprocessableEntityException(err.message);
      }

      // KYC / velocity / SIM-swap / sanctions gate → 403.
      if (
        err instanceof KycNotVerifiedError ||
        err instanceof TierLimitExceededError ||
        err instanceof VelocityExceededError ||
        err instanceof SimSwapBlockedError ||
        err instanceof SanctionsBlockedError
      ) {
        throw new ForbiddenException('Transaction not permitted');
      }

      // Swap not available on this account (e.g. provider 404 / not enrolled) is a
      // PERMANENT, non-retryable condition — surface a graceful 422, not a
      // retryable 502 that invites the user to keep tapping Confirm. Must be
      // checked BEFORE ProviderUnavailableError so it is not clobbered into a 502.
      if (err instanceof SwapUnavailableError) {
        throw new UnprocessableEntityException(
          "Swap isn't available right now. Please try again later or contact support.",
        );
      }

      // External provider (Flutterwave / Blockradar) call failed → 502.
      // A transient provider outage must not surface as an opaque 500; return a
      // clear, retryable message. The engine has already logged the raw cause.
      if (err instanceof ProviderUnavailableError) {
        throw new BadGatewayException(
          'Payment provider is temporarily unavailable. Please try again in a moment.',
        );
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

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ): Promise<TransactionListResponse> {
    const limit = Math.min(
      Math.max(Number(limitRaw) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const rows = await this.transactionRepo.findByUserId(user.userId, {
      limit,
      cursor,
    });
    const items = rows.map((t) => {
      const meta = t.metadata;
      const str = (k: string) =>
        typeof meta[k] === 'string' ? meta[k] : undefined;
      const counterparty =
        str('destination') ?? str('counterparty') ?? str('senderAddress');
      // Deposits store the amount under `amount`; trades use `cryptoAmount`.
      const cryptoAmt = str('cryptoAmount') ?? str('amount');
      return {
        id: t.id,
        type: t.type,
        status: t.status,
        ...(str('asset') ? { asset: str('asset') } : {}),
        ...(cryptoAmt ? { cryptoAmount: cryptoAmt } : {}),
        ...(str('fiatAmount') ? { fiatAmount: str('fiatAmount') } : {}),
        ...(str('fiatCurrency') ? { fiatCurrency: str('fiatCurrency') } : {}),
        ...(counterparty ? { counterparty } : {}),
        createdAt: t.createdAt.toISOString(),
      };
    });
    const nextCursor =
      rows.length === limit ? rows[rows.length - 1].id : undefined;
    return TransactionListResponseSchema.parse({
      items,
      ...(nextCursor ? { nextCursor } : {}),
    });
  }

  @Get(':id')
  async getStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TransactionStatusResponse> {
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

    // Derive direction: prefer an explicit metadata flag, fall back to type heuristic.
    const direction: 'in' | 'out' = INFLOW_TYPES.has(transaction.type)
      ? 'in'
      : 'out';

    // Counterparty: prefer destination (send), then senderAddress (deposit).
    const counterparty =
      typeof meta.destination === 'string'
        ? meta.destination
        : typeof meta.senderAddress === 'string'
          ? meta.senderAddress
          : undefined;

    // On-chain fields — present for deposits (from Blockradar webhook) and sends.
    const txHash = typeof meta.txHash === 'string' ? meta.txHash : undefined;
    const blockNumber =
      typeof meta.blockNumber === 'number' ? meta.blockNumber : undefined;
    const confirmations =
      typeof meta.confirmations === 'number' ? meta.confirmations : undefined;
    const network = typeof meta.network === 'string' ? meta.network : undefined;
    const fees = typeof meta.fees === 'string' ? meta.fees : undefined;

    return {
      id: transaction.id,
      type: transaction.type,
      status: transaction.status,
      direction,
      ...(receiptNumber !== undefined ? { receiptNumber } : {}),
      ...(payment !== undefined ? { payment } : {}),
      ...(typeof meta.asset === 'string' ? { asset: meta.asset } : {}),
      ...(network !== undefined ? { network } : {}),
      ...(typeof meta.cryptoAmount === 'string'
        ? { cryptoAmount: meta.cryptoAmount }
        : typeof meta.amount === 'string'
          ? { cryptoAmount: meta.amount }
          : {}),
      ...(typeof meta.fiatAmount === 'string'
        ? { fiatAmount: meta.fiatAmount }
        : {}),
      ...(typeof meta.fiatCurrency === 'string'
        ? { fiatCurrency: meta.fiatCurrency }
        : {}),
      ...(txHash !== undefined ? { txHash } : {}),
      ...(blockNumber !== undefined ? { blockNumber } : {}),
      ...(confirmations !== undefined ? { confirmations } : {}),
      ...(counterparty !== undefined ? { counterparty } : {}),
      ...(fees !== undefined ? { fees } : {}),
      createdAt: transaction.createdAt.toISOString(),
    };
  }
}
