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
};

const STATUS_TEXT: Readonly<Record<number, string>> = {
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
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
