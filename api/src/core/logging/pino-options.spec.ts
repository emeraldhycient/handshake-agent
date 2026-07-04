/**
 * Unit spec for buildPinoHttpOptions (H1 — secrets exposure hardening).
 *
 * pino-http / nestjs-pino default req serializer copies ALL request headers into
 * every log line — including `Authorization: Bearer <jwt>`, cookies, api keys,
 * and webhook signatures. Without a `redact` config these are logged in plaintext
 * and can be replayed by anyone with log access. These tests pin the redaction
 * contract: the sensitive header paths must be censored, and the censor actually
 * works when a real pino instance logs a request carrying those headers.
 */

import { Writable } from 'node:stream';

import pino from 'pino';

import { buildPinoHttpOptions, REDACT_PATHS } from './pino-options';

describe('buildPinoHttpOptions', () => {
  it('configures a redact block covering every sensitive request/response header', () => {
    const options = buildPinoHttpOptions('production');

    expect(options.redact).toBeDefined();
    const redact = options.redact as { paths: string[]; censor: string };

    expect(redact.censor).toBe('[REDACTED]');
    // Every sensitive path an attacker could replay must be present.
    for (const path of [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-hub-signature-256"]',
      'req.headers["x-blockradar-signature"]',
      'req.headers["verif-hash"]',
      'res.headers["set-cookie"]',
    ]) {
      expect(redact.paths).toContain(path);
    }
  });

  it('exports REDACT_PATHS used to build the redact block', () => {
    expect(REDACT_PATHS).toContain('req.headers.authorization');
    expect(REDACT_PATHS).toContain('res.headers["set-cookie"]');
  });

  it('enables the pino-pretty transport only outside production', () => {
    expect(buildPinoHttpOptions('development').transport).toBeDefined();
    expect(buildPinoHttpOptions('test').transport).toBeDefined();
    expect(buildPinoHttpOptions('production').transport).toBeUndefined();
  });

  it('actually censors an Authorization header when a pino instance logs it', async () => {
    const options = buildPinoHttpOptions('production');

    let output = '';
    const sink = new Writable({
      write(chunk: Buffer, _enc, cb) {
        output += chunk.toString();
        cb();
      },
    });

    const logger = pino({ redact: options.redact }, sink);
    logger.info(
      {
        req: {
          headers: {
            authorization: 'Bearer super-secret-jwt-token',
            cookie: 'session=abc123',
            'x-api-key': 'live_key_leak',
          },
        },
        res: { headers: { 'set-cookie': 'session=abc123; HttpOnly' } },
      },
      'incoming request',
    );

    // Flush the async pino write.
    await new Promise((resolve) => setImmediate(resolve));

    expect(output).not.toContain('super-secret-jwt-token');
    expect(output).not.toContain('abc123');
    expect(output).not.toContain('live_key_leak');
    expect(output).toContain('[REDACTED]');
  });
});
