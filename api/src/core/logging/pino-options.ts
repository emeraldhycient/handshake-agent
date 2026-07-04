/**
 * Pino HTTP logging options (H1 — secrets exposure hardening).
 *
 * nestjs-pino / pino-http default to `autoLogging` ON with a req serializer that
 * copies EVERY request header into every log line — including bearer tokens,
 * cookies, api keys, and webhook signatures. Anyone with log access could replay
 * those credentials. `redact` censors the sensitive paths before they are ever
 * serialized.
 *
 * Extracted as a pure function so the redaction contract is unit-testable
 * independently of the Nest module graph.
 */

import type { Options as PinoHttpOptions } from 'pino-http';

/** Censor placeholder written in place of any redacted value. */
export const REDACT_CENSOR = '[REDACTED]';

/**
 * Header paths whose values are credentials/signatures and must never be logged.
 * Bracket-quoted paths are required for header names containing `-` (pino's path
 * syntax treats an unquoted `-` as an operator, not a key).
 */
export const REDACT_PATHS: readonly string[] = [
  // User + admin session bearer tokens.
  'req.headers.authorization',
  // Session cookies (admin console uses cookie-bound sessions).
  'req.headers.cookie',
  // Internal / provider api keys.
  'req.headers["x-api-key"]',
  // Meta WhatsApp Cloud API webhook signature.
  'req.headers["x-hub-signature-256"]',
  // Blockradar deposit/withdraw webhook signature.
  'req.headers["x-blockradar-signature"]',
  // Flutterwave webhook verification hash.
  'req.headers["verif-hash"]',
  // Any Set-Cookie we emit (would leak freshly minted session cookies).
  'res.headers["set-cookie"]',
];

/**
 * Build the `pinoHttp` options for `LoggerModule.forRoot`.
 *
 * @param nodeEnv the effective `NODE_ENV`; `pino-pretty` is enabled everywhere
 *   except production (raw JSON in prod, as before).
 */
export function buildPinoHttpOptions(
  nodeEnv: string | undefined,
): PinoHttpOptions {
  return {
    // Redaction applies before serialization, so credentials never reach a log
    // sink. Kept in prod AND dev — the pretty transport prints the censored form.
    redact: {
      paths: [...REDACT_PATHS],
      censor: REDACT_CENSOR,
    },
    transport: nodeEnv !== 'production' ? { target: 'pino-pretty' } : undefined,
  };
}
