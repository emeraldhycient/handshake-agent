/**
 * DomainExceptionFilter — the global exception filter (I1/I2).
 *
 * Turns thrown domain errors into the CORRECT HTTP status with a clean,
 * client-safe message. Without it, any domain error that a controller does not
 * explicitly catch (e.g. an InsufficientBalanceError raised inside the
 * /chat/messages flow, or an agent/LLM failure) bubbles out as an opaque 500 —
 * leaking internal detail and mis-signalling an "expected" outcome as a server
 * crash.
 *
 * Matching is by the error's stable `code` (its documented cross-boundary
 * discriminant), so this core filter imports NO feature error classes — it stays
 * decoupled from every module's domain. Anything not allow-listed below falls
 * through to a generic 500 with the original error logged server-side only.
 *
 * NestJS HttpExceptions are already client-safe (the controllers map their own
 * domain errors to these), so they pass through with their status + body intact.
 */

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface MappedError {
  status: HttpStatus;
  message: string;
}

/**
 * Allow-list: domain `code` → client-facing { status, message }.
 * Messages are deliberately generic — the raw domain message (which may carry
 * limits, balances, addresses, or compliance event ids) is NEVER sent to the
 * client; only logged server-side.
 */
const DOMAIN_ERROR_MAP: Readonly<Record<string, MappedError>> = {
  // ── Authorization (PIN + directive) → 401 ──────────────────────────────────
  PIN_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Authorization failed.',
  },
  PIN_NOT_SET: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Authorization failed.',
  },
  PIN_LOCKED: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Your PIN is temporarily locked. Please try again later.',
  },
  DIRECTIVE_EXPIRED: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Your authorization expired. Please try again.',
  },
  DIRECTIVE_REPLAY: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Authorization failed.',
  },
  DIRECTIVE_PROPOSAL_MISMATCH: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Authorization failed.',
  },
  DIRECTIVE_SIGNATURE_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Authorization failed.',
  },

  // ── KYC / limits / velocity / SIM-swap / sanctions → 403 ───────────────────
  KYC_NOT_VERIFIED: {
    status: HttpStatus.FORBIDDEN,
    message: 'This transaction is not permitted on your account.',
  },
  TIER_LIMIT_EXCEEDED: {
    status: HttpStatus.FORBIDDEN,
    message: 'This transaction is not permitted on your account.',
  },
  SEND_LIMIT_EXCEEDED: {
    status: HttpStatus.FORBIDDEN,
    message: 'This transaction is not permitted on your account.',
  },
  VELOCITY_EXCEEDED: {
    status: HttpStatus.FORBIDDEN,
    message: 'This transaction is not permitted on your account.',
  },
  SIM_SWAP_BLOCKED: {
    status: HttpStatus.FORBIDDEN,
    message: 'This transaction is not permitted on your account.',
  },
  SANCTIONS_BLOCKED: {
    status: HttpStatus.FORBIDDEN,
    message: 'This transaction is not permitted.',
  },

  // ── Validation / wrong state → 422 / 409 ───────────────────────────────────
  SELL_INSUFFICIENT_BALANCE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Insufficient balance for this transaction.',
  },
  ENGINE_PROPOSAL_EXPIRED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'This proposal has expired. Please start again.',
  },
  ENGINE_QUOTE_DRIFT: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'The quote changed. Please re-quote and try again.',
  },
  SWAP_SAME_ASSET: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Choose two different assets to swap.',
  },
  // Swap unavailable is a non-retryable "capability not offered right now"
  // condition — 422, NOT a retryable 502/503 that invites endless retries.
  SWAP_PROVIDER_UNAVAILABLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      "Swap isn't available right now. Please try again later or contact support.",
  },
  ENGINE_PROPOSAL_NOT_EXECUTABLE: {
    status: HttpStatus.CONFLICT,
    message: 'This proposal can no longer be processed.',
  },
  ENGINE_SETTLEMENT_INVALID_STATUS: {
    status: HttpStatus.CONFLICT,
    message: 'This transaction can no longer be processed.',
  },

  // ── Transient / provider-unavailable / fail-closed config → 503 ────────────
  AGENT_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'The assistant is temporarily unavailable. Please try again.',
  },
  SANCTIONS_SCREENING_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Service temporarily unavailable. Please try again.',
  },
  ENGINE_BASE_RATE_MISCONFIGURED: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Service temporarily unavailable. Please try again.',
  },
  RECEIPT_NOT_SIGNABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Service temporarily unavailable. Please try again.',
  },
  DIRECTIVE_NOT_MINTABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Service temporarily unavailable. Please try again.',
  },

  // ── Beneficiaries → 403 (first-use lock) / 404 / 422 ───────────────────────
  BENEFICIARY_COOLING_OFF: {
    status: HttpStatus.FORBIDDEN,
    message:
      'For your security, newly added recipients have a short cooling-off ' +
      'period before the first transfer. Please try again later.',
  },
  BENEFICIARY_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Recipient not found.',
  },
  BENEFICIARY_INVALID_ADDRESS: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      "That address isn't valid for the selected network. " +
      'Please check it and try again.',
  },
  BENEFICIARY_WRONG_TYPE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "That recipient can't be used for this transaction.",
  },
  BENEFICIARY_NAME_ENQUIRY_FAILED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      "We couldn't verify that bank account. " +
      'Please check the details and try again.',
  },

  // ── Admin platform (RBAC console) → 401 / 403 / 404 / 409 / 410 ─────────────
  // Distinct principal from end users; messages are admin-operator-facing (no
  // end-user fund detail), and the `code` is echoed so the admin UI can react
  // (e.g. ADMIN_STEP_UP_REQUIRED → open the re-auth modal).
  ADMIN_INVALID_CREDENTIALS: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Invalid credentials.',
  },
  ADMIN_MFA_REQUIRED: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'A multi-factor code is required.',
  },
  ADMIN_MFA_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'The multi-factor code is invalid.',
  },
  ADMIN_INACTIVE: {
    status: HttpStatus.FORBIDDEN,
    message: 'This admin account is not active.',
  },
  ADMIN_STEP_UP_REQUIRED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Please re-authenticate to perform this action.',
  },
  ADMIN_PERMISSION_DENIED: {
    status: HttpStatus.FORBIDDEN,
    message: 'You do not have permission to perform this action.',
  },
  ADMIN_BOOTSTRAP_FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: 'Bootstrap is not available.',
  },
  ADMIN_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Not found.',
  },
  ADMIN_BUILTIN_ROLE_IMMUTABLE: {
    status: HttpStatus.CONFLICT,
    message: 'Built-in roles cannot be modified.',
  },
  ADMIN_INVITATION_INVALID: {
    status: HttpStatus.GONE,
    message: 'This invitation is invalid or has expired.',
  },
  // Transaction triage (Phase 3B): the txn is in a state that cannot be triaged
  // (not settling, or a type with no reserve to refund) → 409 Conflict.
  ADMIN_TXN_NOT_TRIAGEABLE: {
    status: HttpStatus.CONFLICT,
    message: 'This transaction cannot be triaged in its current state.',
  },
  // Approvals / maker-checker (Phase 7): four-eyes enforcement + decision guards.
  ADMIN_SELF_APPROVAL_FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: 'You cannot approve or reject your own change request.',
  },
  ADMIN_CHANGE_REQUEST_NOT_PENDING: {
    status: HttpStatus.CONFLICT,
    message: 'This change request has already been decided.',
  },
  ADMIN_CHANGE_REQUEST_NOT_APPLICABLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'This change request cannot be applied.',
  },
  ADMIN_BULK_CONFIRMATION_REQUIRED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      'This broadcast is over the large-set threshold; explicit confirmation is required.',
  },
  // Manual credit (Phase 7): the credited user's server-side state forbids it
  // (deactivated / sanctions-flagged / no wallet on the asset's network) → 422.
  ADMIN_MANUAL_CREDIT_NOT_ALLOWED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'A manual credit is not allowed for this user.',
  },

  // ── Admin config settings (layered-config console) → 409 / 422 ──────────────
  ADMIN_SETTING_NOT_EDITABLE: {
    status: HttpStatus.CONFLICT,
    message: 'This setting cannot be edited.',
  },
  ADMIN_SETTING_INVALID: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'The proposed value is invalid for this setting.',
  },
  ADMIN_MULTI_CURRENCY_INVARIANT: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      'This change would leave an enabled currency without limits or pricing.',
  },
  // Runtime "Add currency": the proposed code collides with a built-in catalog
  // fiat or an existing custom fiat (a custom fiat may not shadow a currency) → 409.
  ADMIN_CURRENCY_COLLISION: {
    status: HttpStatus.CONFLICT,
    message: 'A currency with this code already exists.',
  },

  // ── Amount guards (engine) → 422 — clear, non-sensitive validation copy ─────
  AMOUNT_TOO_SMALL: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'That amount is below the minimum allowed for this transaction.',
  },
  SELF_SEND_BLOCKED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "That's your own wallet address — no transfer is needed.",
  },

  // ── Auth / PIN-setup / KYC (backstops; controllers also map these) ─────────
  PIN_WEAK: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      'Choose a stronger PIN: 4–6 digits, not all the same and not a simple sequence.',
  },
  PIN_SETUP_NOT_VERIFIED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Please complete identity verification before setting a PIN.',
  },
  PIN_ALREADY_SET: {
    status: HttpStatus.CONFLICT,
    message: 'A PIN is already set for this account.',
  },
  OTP_LOCKED: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Too many attempts. Please request a new code.',
  },
  KYC_REJECTED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      "We couldn't verify your identity with the details provided. " +
      'Please check them and try again.',
  },
};

const STATUS_TEXT: Readonly<Record<number, string>> = {
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.GONE]: 'Gone',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 1. NestJS HttpExceptions are already client-safe (controllers map domain
    //    errors to these) — preserve their status + body exactly.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(this.httpExceptionBody(exception, status));
      return;
    }

    // 2. Known domain error (by stable `code`) → mapped status + clean message.
    const code = this.readCode(exception);
    const mapped = code ? DOMAIN_ERROR_MAP[code] : undefined;
    if (mapped) {
      // Logged at warn — an expected domain outcome, with the real detail kept
      // server-side; the client only ever sees `mapped.message`.
      this.logger.warn(
        { code, path: request?.url, err: this.describe(exception) },
        `Domain error → ${mapped.status}`,
      );
      response.status(mapped.status).json({
        statusCode: mapped.status,
        message: mapped.message,
        error: STATUS_TEXT[mapped.status] ?? 'Error',
        code,
      });
      return;
    }

    // 3. Anything else is unexpected — log the full error server-side and return
    //    a generic 500. NEVER leak the message/stack/internal code to the client.
    this.logger.error(
      { path: request?.url, err: this.describe(exception) },
      'Unhandled exception → 500',
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Something went wrong. Please try again.',
      error: 'Internal Server Error',
    });
  }

  /** Reproduces NestJS' HttpException body (string responses get wrapped). */
  private httpExceptionBody(exception: HttpException, status: number): object {
    const res = exception.getResponse();
    if (typeof res === 'string') {
      return {
        statusCode: status,
        message: res,
        error: STATUS_TEXT[status] ?? 'Error',
      };
    }
    return res;
  }

  /** Safely read a stable string `code` off an unknown thrown value. */
  private readCode(exception: unknown): string | undefined {
    if (
      typeof exception === 'object' &&
      exception !== null &&
      'code' in exception
    ) {
      const code: unknown = exception.code;
      return typeof code === 'string' ? code : undefined;
    }
    return undefined;
  }

  /** Structured, log-only description — never serialized to the client. */
  private describe(exception: unknown): {
    name?: string;
    message?: string;
    stack?: string;
  } {
    if (exception instanceof Error) {
      return {
        name: exception.name,
        message: exception.message,
        stack: exception.stack,
      };
    }
    return { message: String(exception) };
  }
}
