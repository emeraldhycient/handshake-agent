/**
 * WhatsApp Flow data endpoint (Task 6.2).
 *
 * POST /whatsapp/flow
 *
 * Meta calls this endpoint with an E2E-encrypted body whenever a user submits
 * a WhatsApp Flow screen. This controller:
 *
 *   1. Decrypts the body via FlowCryptoService (FLOW_CRYPTO port).
 *   2. Routes by `action`:
 *      - ping           → { data: { status: 'active' } }
 *      - INIT           → { screen: 'CONFIRM', data: <minimal proposal echo> }
 *      - data_exchange  → verifies flow_token, runs executeBuy, returns SUCCESS/ERROR screen
 *   3. Encrypts every response through FlowCryptoService.encryptResponse (same AES
 *      key + bit-flipped IV) and returns the base64 string as plain text (200).
 *
 * On FlowDecryptError / FlowKeyNotConfiguredError the controller responds 421
 * (Misdirected Request) so the WhatsApp client refreshes the public key (§3.5).
 *
 * Security invariants:
 *   - §3.1: only proposes and verifies; executeBuy is the engine.
 *   - §3.5: PIN + nonce arrive ONLY in the decrypted payload; never logged.
 *   - No PIN, no nonce, no raw error internals in any response.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import {
  FLOW_CRYPTO,
  type IFlowCrypto,
  type FlowEncryptedBody,
} from '../application/ports/flow-crypto.port';
import {
  FlowDecryptError,
  FlowKeyNotConfiguredError,
} from '../domain/flow-errors';
import { ExecutionService } from '../../transactions/application/execution.service';
import { BeneficiaryService } from '../../beneficiaries/application/beneficiary.service';
import {
  InvalidAddressError,
  NameEnquiryFailedError,
} from '../../beneficiaries/domain/beneficiary-errors';
import { UnsupportedFiatError } from '../../../core/catalog/catalog-errors';
import { PinService } from '../../../core/auth/pin.service';
import { SessionService } from '../../../core/auth/session.service';
import { StepUpRequiredError } from '../../../core/auth/domain/session-errors';
import { verifyFlowToken } from '../application/flow-token';
import {
  PROPOSAL_REPOSITORY,
  type IProposalRepository,
} from '../../transactions/application/ports/proposal.repository.port';
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
import type { Env } from '../../../core/config/env.schema';

// ---------------------------------------------------------------------------
// Decrypted payload shape
// ---------------------------------------------------------------------------

interface FlowDecryptedPayload {
  version: string;
  action: string;
  screen?: string;
  flow_token?: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

// Meta machine-to-machine callback (E2E-encrypted Flow data exchange), delivered
// from Meta's shared egress IPs. Exempt from the global IP-keyed throttler (which
// would rate-limit all users together); requests are authenticated by RSA/AES
// decryption + the signed flow_token, not by IP.
@Controller('whatsapp')
@SkipThrottle()
export class WhatsAppFlowController {
  private readonly logger = new Logger(WhatsAppFlowController.name);

  constructor(
    @Inject(FLOW_CRYPTO) private readonly flowCrypto: IFlowCrypto,
    private readonly executionService: ExecutionService,
    private readonly beneficiaryService: BeneficiaryService,
    private readonly configService: ConfigService<Env, true>,
    @Inject(PROPOSAL_REPOSITORY)
    private readonly proposalRepo: IProposalRepository,
    private readonly pinService: PinService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * POST /whatsapp/flow
   *
   * Body: { encrypted_flow_data, encrypted_aes_key, initial_vector } (base64 strings).
   * Response: encrypted base64 string (text/plain, 200) or HTTP 421 on decrypt failure.
   *
   * Note: `@Res()` is used to set the Content-Type header to text/plain before
   * returning the raw base64 string. The method still returns the string value;
   * NestJS passes it through when @Res({ passthrough: true }) is set.
   */
  @Post('flow')
  @HttpCode(HttpStatus.OK)
  async handleFlow(
    @Body() body: FlowEncryptedBody,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    // ── Step 1: Decrypt ──────────────────────────────────────────────────────
    let decrypted: FlowDecryptedPayload;
    let aesKey: Buffer;
    let iv: Buffer;

    try {
      const result = this.flowCrypto.decryptRequest(body);
      decrypted = result.decrypted as FlowDecryptedPayload;
      aesKey = result.aesKey;
      iv = result.iv;
    } catch (err) {
      if (
        err instanceof FlowDecryptError ||
        err instanceof FlowKeyNotConfiguredError
      ) {
        this.logger.warn(
          { errorName: err.name },
          'Flow decrypt failed — responding 421 so client refreshes public key',
        );
        throw new HttpException('Flow decryption failed', 421);
      }
      throw err;
    }

    // ── Step 2: Route by action ──────────────────────────────────────────────
    const responseObj = await this.routeAction(decrypted);

    // ── Step 3: Encrypt response ─────────────────────────────────────────────
    res.type('text/plain');
    return this.flowCrypto.encryptResponse(responseObj, aesKey, iv);
  }

  // ---------------------------------------------------------------------------
  // Private — action routing
  // ---------------------------------------------------------------------------

  private async routeAction(payload: FlowDecryptedPayload): Promise<unknown> {
    const { action } = payload;

    if (action === 'ping') {
      return { data: { status: 'active' } };
    }

    if (action === 'INIT') {
      return this.handleInit(payload);
    }

    if (action === 'data_exchange') {
      return this.handleDataExchange(payload);
    }

    // Unknown action — return a safe error screen (no internals).
    this.logger.warn({ action }, 'Unknown Flow action received');
    return {
      screen: 'ERROR',
      data: { message: 'Unknown action. Please try again.' },
    };
  }

  private handleInit(payload: FlowDecryptedPayload): unknown {
    // INIT carries the flow_token minted by ConversationService (6.3).
    // Verify it so we know the proposal context, then echo minimal confirmation.
    if (!payload.flow_token) {
      return { screen: 'ERROR', data: { message: 'Missing flow token.' } };
    }

    const signingKey = this.configService.get('DIRECTIVE_SIGNING_KEY', {
      infer: true,
    });

    try {
      const { proposalId } = verifyFlowToken(payload.flow_token, signingKey);
      // Return a minimal CONFIRM screen. Full proposal details are carried in
      // the Flow's initial data payload seeded by ConversationService (6.3).
      return {
        screen: 'CONFIRM',
        data: { proposalId },
      };
    } catch {
      return {
        screen: 'ERROR',
        data: { message: 'Invalid or expired session. Please start again.' },
      };
    }
  }

  private async handleDataExchange(
    payload: FlowDecryptedPayload,
  ): Promise<unknown> {
    if (!payload.flow_token) {
      return { screen: 'ERROR', data: { message: 'Missing flow token.' } };
    }

    const signingKey = this.configService.get('DIRECTIVE_SIGNING_KEY', {
      infer: true,
    });

    // Verify flow_token to extract the proposal context.
    let proposalId: string;
    let directiveId: string;
    let userId: string;

    try {
      const tokenPayload = verifyFlowToken(payload.flow_token, signingKey);
      proposalId = tokenPayload.proposalId;
      directiveId = tokenPayload.directiveId;
      userId = tokenPayload.userId;
    } catch {
      return {
        screen: 'ERROR',
        data: { message: 'Session expired or invalid. Please start again.' },
      };
    }

    const data = payload.data ?? {};
    const action = typeof data.action === 'string' ? data.action : '';

    // Route beneficiary-specific actions before the proposal execution flow.
    if (action === 'beneficiary_select') {
      return this.handleBeneficiarySelect(userId, data);
    }
    if (action === 'beneficiary_add') {
      return this.handleBeneficiaryAdd(userId, data);
    }

    // Default: proposal confirmation flow — extract PIN + nonce (§3.5: never log them).
    const pin = typeof data.pin === 'string' ? data.pin : '';
    const nonce = typeof data.nonce === 'string' ? data.nonce : '';

    if (!pin || !nonce) {
      return { screen: 'ERROR', data: { message: 'Incomplete submission.' } };
    }

    // Resolve the proposal type to dispatch to the correct execution method (W1).
    // Read from the DB for integrity — do not trust any client-supplied type field.
    const proposalType = await this.proposalRepo.getType(proposalId);

    if (proposalType === null) {
      this.logger.warn({ proposalId }, 'Proposal not found for flow execution');
      return {
        screen: 'ERROR',
        data: { message: 'Session expired or invalid. Please start again.' },
      };
    }

    // Run the deterministic engine (§3.1: only the engine moves money).
    try {
      return await this.executeByType({
        proposalType,
        userId,
        proposalId,
        directiveId,
        nonce,
        pin,
      });
    } catch (err) {
      // Map known domain errors to safe, user-friendly messages.
      // NEVER leak internal error messages, PIN, or nonce.
      const message = this.mapExecutionError(err);
      this.logger.warn(
        {
          errorName: err instanceof Error ? err.name : 'unknown',
          proposalType,
        },
        'execution failed — returning ERROR screen',
      );
      return { screen: 'ERROR', data: { message } };
    }
  }

  /**
   * Dispatches execution to the correct engine method based on proposal type (W1).
   * Returns the appropriate SUCCESS screen for each type.
   *
   * Only 'buy', 'sell', and 'send' are executable via the Flow endpoint.
   * Any other type returns an ERROR screen (no internal details).
   */
  private async executeByType(params: {
    proposalType: string;
    userId: string;
    proposalId: string;
    directiveId: string;
    nonce: string;
    pin: string;
  }): Promise<unknown> {
    const { proposalType, userId, proposalId, directiveId, nonce, pin } =
      params;
    const idempotencyKey = proposalId;

    if (proposalType === 'buy') {
      const result = await this.executionService.executeBuy({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin,
        idempotencyKey,
      });
      return {
        screen: 'SUCCESS',
        data: {
          transactionId: result.transactionId,
          accountNumber: result.payment.accountNumber,
          bankName: result.payment.bankName,
          amount: result.payment.amount,
          currency: result.payment.currency,
          message: 'Transfer the amount to complete your purchase.',
        },
      };
    }

    if (proposalType === 'sell') {
      const result = await this.executionService.executeSell({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin,
        idempotencyKey,
      });
      return {
        screen: 'SUCCESS',
        data: {
          transactionId: result.transactionId,
          providerRef: result.payout.providerRef,
          message:
            'Your payout has been initiated. You will be notified once it completes.',
        },
      };
    }

    if (proposalType === 'send') {
      const result = await this.executionService.executeSend({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin,
        idempotencyKey,
      });
      return {
        screen: 'SUCCESS',
        data: {
          transactionId: result.transactionId,
          txRef: result.onChain.providerRef,
          message:
            'Your withdrawal has been initiated. It will be confirmed on-chain shortly.',
        },
      };
    }

    // Unknown proposal type — cannot execute.
    this.logger.warn(
      { proposalType },
      'Unrecognised proposal type for Flow execution',
    );
    return {
      screen: 'ERROR',
      data: {
        message:
          'This transaction type cannot be completed here. Please start again.',
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Beneficiary flow handlers (S3)
  // ---------------------------------------------------------------------------

  /**
   * Handles a `beneficiary_select` data_exchange action.
   * Validates the selected beneficiary belongs to the authenticated user
   * (extracted from flow_token). Returns a confirmation screen or an error.
   */
  private async handleBeneficiarySelect(
    userId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    const beneficiaryId =
      typeof data.beneficiaryId === 'string' ? data.beneficiaryId : '';
    if (!beneficiaryId) {
      return { screen: 'ERROR', data: { message: 'No beneficiary selected.' } };
    }

    try {
      const ben = await this.beneficiaryService.getById(userId, beneficiaryId);
      if (!ben) {
        // Beneficiary does not belong to this user (or does not exist).
        this.logger.warn(
          { userId, beneficiaryId },
          'beneficiary_select: beneficiary not found for user',
        );
        return {
          screen: 'ERROR',
          data: {
            message:
              'Selected account not found. Please choose another or add a new one.',
          },
        };
      }

      // S3: Acknowledge selection; S4 will chain this into the sell proposal.
      return {
        screen: 'BENEFICIARY_CONFIRMED',
        data: {
          beneficiaryId: ben.id,
          label: ben.label,
          message: 'Account selected successfully.',
        },
      };
    } catch (err) {
      this.logger.warn(
        { errorName: err instanceof Error ? err.name : 'unknown' },
        'beneficiary_select failed',
      );
      return {
        screen: 'ERROR',
        data: { message: 'Something went wrong. Please try again.' },
      };
    }
  }

  /**
   * Handles a `beneficiary_add` data_exchange action.
   * Accepts either bank-account fields or crypto-address fields (determined by
   * the presence of `accountNumber` vs `address`). Bank/crypto details — and the
   * PIN — arrive via Flow E2E only, never as plaintext chat and never logged (§3.5).
   *
   * R2 (Wave G): adding a withdrawal destination requires PIN + a fresh
   * device-bound step-up BEFORE persisting — the same chain the web
   * `BeneficiaryController` runs. The PIN is threaded from the E2E-encrypted Flow
   * payload (`data.pin`); it is verified server-side, never echoed back.
   */
  private async handleBeneficiaryAdd(
    userId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    const isBank =
      typeof data.accountNumber === 'string' && data.accountNumber !== '';
    const isCrypto = typeof data.address === 'string' && data.address !== '';

    if (!isBank && !isCrypto) {
      return {
        screen: 'ERROR',
        data: { message: 'No account details provided.' },
      };
    }

    // PIN travels ONLY inside the E2E-encrypted Flow payload (§3.5). Never fall
    // back to a plaintext-chat PIN — absence is a hard error, not a bypass.
    const pin = typeof data.pin === 'string' ? data.pin : '';
    if (!pin) {
      return {
        screen: 'ERROR',
        data: {
          message: 'Please enter your PIN to save this payout account.',
        },
      };
    }
    const deviceFingerprint =
      typeof data.deviceFingerprint === 'string'
        ? data.deviceFingerprint
        : undefined;

    try {
      // R2: verify PIN + record a device-bound step-up BEFORE persisting.
      await this.requireStepUpForAdd(userId, pin, deviceFingerprint);

      return isBank
        ? await this.addBankBeneficiary(userId, data)
        : await this.addCryptoBeneficiary(userId, data);
    } catch (err) {
      this.logger.warn(
        { errorName: err instanceof Error ? err.name : 'unknown' },
        'beneficiary_add failed',
      );
      return {
        screen: 'ERROR',
        data: { message: this.mapBeneficiaryAddError(err) },
      };
    }
  }

  /**
   * Persists a bank beneficiary from the Flow payload. The payout currency is
   * seeded from the sell intent (`data.currency`); the country is derived
   * server-side from it (the client-supplied country is never trusted, §3.3).
   * When the country's rail cannot run name-enquiry the backend persists the
   * account as `unverified` — this surfaces that state in the reply.
   */
  private async addBankBeneficiary(
    userId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    const accountNumber =
      typeof data.accountNumber === 'string' ? data.accountNumber : '';
    const bankCode = typeof data.bankCode === 'string' ? data.bankCode : '';
    const accountName =
      typeof data.accountName === 'string' ? data.accountName : '';
    const label =
      typeof data.label === 'string' && data.label ? data.label : accountName;
    const currency =
      typeof data.currency === 'string' && data.currency
        ? data.currency
        : undefined;

    if (!bankCode || !accountName) {
      return {
        screen: 'ERROR',
        data: { message: 'Incomplete bank account details.' },
      };
    }

    const ben = await this.beneficiaryService.addBankAccount({
      userId,
      accountNumber,
      bankCode,
      accountName,
      label,
      currency,
    });

    const message =
      ben.verificationStatus === 'unverified'
        ? 'Bank account saved. We could not automatically verify the account name for this country — please double-check the details before your first payout.'
        : 'Bank account saved successfully.';

    return {
      screen: 'BENEFICIARY_ADDED',
      data: { beneficiaryId: ben.id, label: ben.label, message },
    };
  }

  /** Persists a crypto-address beneficiary from the Flow payload. */
  private async addCryptoBeneficiary(
    userId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    const address = typeof data.address === 'string' ? data.address : '';
    const network = typeof data.network === 'string' ? data.network : '';
    const asset = typeof data.asset === 'string' ? data.asset : '';
    const label =
      typeof data.label === 'string' && data.label
        ? data.label
        : address.slice(0, 8) + '…';

    if (!network || !asset) {
      return {
        screen: 'ERROR',
        data: { message: 'Incomplete crypto address details.' },
      };
    }

    const ben = await this.beneficiaryService.addCryptoAddress({
      userId,
      address,
      network,
      asset,
      label,
    });

    return {
      screen: 'BENEFICIARY_ADDED',
      data: {
        beneficiaryId: ben.id,
        label: ben.label,
        message:
          'Crypto address saved. A cooling-off period applies before first use.',
      },
    };
  }

  /**
   * Step-up chain for adding a withdrawal destination over WhatsApp (R2) —
   * mirrors `BeneficiaryController.requireStepUpForAdd` (the web surface) and the
   * executeSend money-path: verify the PIN (lockout-protected) then record a
   * device-bound step-up. Fail-closed — an unresolvable device throws
   * StepUpRequiredError so nothing is persisted without a traceable binding (§3.4).
   *
   * WhatsApp has no browser fingerprint, so the device resolves to the user's
   * pinned device; no directive is issued (an add is not a money-moving proposal).
   */
  private async requireStepUpForAdd(
    userId: string,
    pin: string,
    deviceFingerprint: string | undefined,
  ): Promise<void> {
    // 1. Verify PIN first (its own atomic lockout). Throws Pin* domain errors.
    await this.pinService.verifyPin(userId, pin);

    // 2. Resolve the acting device: client fingerprint → else the pinned device.
    const deviceId =
      (await this.sessionService.findDeviceIdByFingerprint(
        userId,
        deviceFingerprint,
      )) ?? (await this.sessionService.findPinnedDeviceId(userId));

    // 3. No traceable device → cannot record a device-bound step-up (fail-closed).
    if (!deviceId) {
      throw new StepUpRequiredError('no_session');
    }

    // 4. Record the device-bound step-up (mirrors executeSend Step 7b).
    const now = new Date();
    await this.sessionService.startOrTouch(userId, deviceId);
    await this.sessionService.recordStepUp(userId, deviceId, now);
  }

  /**
   * Maps a beneficiary-add failure to a safe, user-friendly message.
   * NEVER leaks internal error text, the PIN, or account internals (§3.5).
   */
  private mapBeneficiaryAddError(err: unknown): string {
    if (err instanceof PinInvalidError) {
      return 'Incorrect PIN. Please try again.';
    }
    if (err instanceof PinLockedError) {
      return 'Your account is temporarily locked due to too many PIN attempts. Please try again later.';
    }
    if (err instanceof PinNotSetError) {
      return 'No PIN is set on your account. Please set a PIN in the app first.';
    }
    if (err instanceof StepUpRequiredError) {
      return 'We could not verify your device. Please sign in on the web app, then try again.';
    }
    if (err instanceof InvalidAddressError) {
      return 'The crypto address you entered appears to be invalid. Please check and try again.';
    }
    if (err instanceof NameEnquiryFailedError) {
      return 'Could not verify this bank account. Please check the account number and bank, then try again.';
    }
    if (err instanceof UnsupportedFiatError) {
      return "We can't add a bank account for that currency yet.";
    }
    return 'Something went wrong. Please try again.';
  }

  /**
   * Maps known domain errors to user-friendly messages.
   * Returns a generic fallback for unknown errors — no internals.
   */
  private mapExecutionError(err: unknown): string {
    if (err instanceof PinInvalidError) {
      return 'Incorrect PIN. Please try again.';
    }
    if (err instanceof PinLockedError) {
      return 'Your account is temporarily locked due to too many PIN attempts. Please try again later.';
    }
    if (err instanceof PinNotSetError) {
      return 'No PIN is set on your account. Please set a PIN in the app first.';
    }
    if (err instanceof ProposalExpiredError || err instanceof QuoteDriftError) {
      return 'Your quote has expired. Please request a new quote.';
    }
    if (err instanceof DirectiveExpiredError) {
      return 'Your authorization has expired. Please start a new transaction.';
    }
    if (
      err instanceof DirectiveReplayError ||
      err instanceof DirectiveProposalMismatchError ||
      err instanceof DirectiveSignatureError
    ) {
      return 'Authorization error. Please start a new transaction.';
    }
    if (err instanceof ProposalNotExecutableError) {
      return 'This transaction is no longer available. Please start again.';
    }
    if (
      err instanceof KycNotVerifiedError ||
      err instanceof TierLimitExceededError ||
      err instanceof VelocityExceededError ||
      err instanceof SimSwapBlockedError
    ) {
      return 'Transaction blocked. Please check your account status in the app.';
    }
    // Generic fallback — no internals.
    return 'Something went wrong. Please try again or contact support.';
  }
}
