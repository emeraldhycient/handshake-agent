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
 * decoupled from every module's domain. The allow-list itself lives in the
 * sibling `domain-error-map.ts` (pure data); anything not allow-listed there
 * falls through to a generic 500 with the original error logged server-side only.
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

import { DOMAIN_ERROR_MAP, STATUS_TEXT } from './domain-error-map';

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
