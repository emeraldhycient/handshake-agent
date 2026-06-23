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
import { InvalidAddressError } from '../../beneficiaries/domain/beneficiary-errors';
import { verifyFlowToken } from '../application/flow-token';
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

@Controller('whatsapp')
export class WhatsAppFlowController {
  private readonly logger = new Logger(WhatsAppFlowController.name);

  constructor(
    @Inject(FLOW_CRYPTO) private readonly flowCrypto: IFlowCrypto,
    private readonly executionService: ExecutionService,
    private readonly beneficiaryService: BeneficiaryService,
    private readonly configService: ConfigService<Env, true>,
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

    // Route beneficiary-specific actions before the buy flow.
    if (action === 'beneficiary_select') {
      return this.handleBeneficiarySelect(userId, data);
    }
    if (action === 'beneficiary_add') {
      return this.handleBeneficiaryAdd(userId, data);
    }

    // Default: buy confirmation flow — extract PIN + nonce (§3.5: never log them).
    const pin = typeof data.pin === 'string' ? data.pin : '';
    const nonce = typeof data.nonce === 'string' ? data.nonce : '';

    if (!pin || !nonce) {
      return { screen: 'ERROR', data: { message: 'Incomplete submission.' } };
    }

    // Run the deterministic engine (§3.1: only the engine moves money).
    try {
      const result = await this.executionService.executeBuy({
        userId,
        proposalId,
        directiveId,
        nonce,
        pin,
        idempotencyKey: proposalId,
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
    } catch (err) {
      // Map known domain errors to safe, user-friendly messages.
      // NEVER leak internal error messages, PIN, or nonce.
      const message = this.mapExecutionError(err);
      this.logger.warn(
        { errorName: err instanceof Error ? err.name : 'unknown' },
        'executeBuy failed — returning ERROR screen',
      );
      return { screen: 'ERROR', data: { message } };
    }
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
   * the presence of `accountNumber` vs `address`). Bank/crypto details arrive
   * via Flow E2E only — never logged.
   */
  private async handleBeneficiaryAdd(
    userId: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      // Discriminate by the presence of accountNumber (bank) vs address (crypto).
      if (typeof data.accountNumber === 'string' && data.accountNumber) {
        // Bank account add
        const accountNumber = data.accountNumber;
        const bankCode = typeof data.bankCode === 'string' ? data.bankCode : '';
        const accountName =
          typeof data.accountName === 'string' ? data.accountName : '';
        const label =
          typeof data.label === 'string' && data.label
            ? data.label
            : accountName;

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
        });

        return {
          screen: 'BENEFICIARY_ADDED',
          data: {
            beneficiaryId: ben.id,
            label: ben.label,
            message: 'Bank account saved successfully.',
          },
        };
      }

      if (typeof data.address === 'string' && data.address) {
        // Crypto address add
        const address = data.address;
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

      return {
        screen: 'ERROR',
        data: { message: 'No account details provided.' },
      };
    } catch (err) {
      if (err instanceof InvalidAddressError) {
        return {
          screen: 'ERROR',
          data: {
            message:
              'The crypto address you entered appears to be invalid. Please check and try again.',
          },
        };
      }
      this.logger.warn(
        { errorName: err instanceof Error ? err.name : 'unknown' },
        'beneficiary_add failed',
      );
      return {
        screen: 'ERROR',
        data: { message: 'Something went wrong. Please try again.' },
      };
    }
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
