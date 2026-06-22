import { Logger, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { hmacHex } from '../../../../core/crypto/hmac';
import type { Env } from '../../../../core/config/env.schema';
import { WhatsAppSignatureGuard } from './whatsapp-signature.guard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const APP_SECRET = 'test-app-secret';
const BODY = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

function makeValidHeader(): string {
  return `sha256=${hmacHex('sha256', APP_SECRET, BODY)}`;
}

function makeContext(opts: {
  rawBody?: Buffer;
  header?: string | undefined;
}): ExecutionContext {
  const req: Record<string, unknown> = {
    rawBody: opts.rawBody,
    headers: {
      'x-hub-signature-256': opts.header,
    },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

function makeConfig(
  appSecret: string,
  nodeEnv: 'development' | 'test' | 'production' = 'test',
): ConfigService<Env, true> {
  return {
    get: jest.fn((key: keyof Env) => {
      if (key === 'WHATSAPP_APP_SECRET') return appSecret;
      if (key === 'NODE_ENV') return nodeEnv;
      return undefined;
    }),
  } as unknown as ConfigService<Env, true>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WhatsAppSignatureGuard', () => {
  it('allows a request with a valid signature and app secret set', async () => {
    const guard = new WhatsAppSignatureGuard(makeConfig(APP_SECRET));
    const ctx = makeContext({ rawBody: BODY, header: makeValidHeader() });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws UnauthorizedException for an invalid signature', async () => {
    const guard = new WhatsAppSignatureGuard(makeConfig(APP_SECRET));
    const ctx = makeContext({
      rawBody: BODY,
      header: `sha256=${'0'.repeat(64)}`, // wrong digest
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException for a missing rawBody when secret is set', async () => {
    const guard = new WhatsAppSignatureGuard(makeConfig(APP_SECRET));
    const ctx = makeContext({ rawBody: undefined, header: makeValidHeader() });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException for a missing signature header when secret is set', async () => {
    const guard = new WhatsAppSignatureGuard(makeConfig(APP_SECRET));
    const ctx = makeContext({ rawBody: BODY, header: undefined });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows + logs a warning when secret is empty in development', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const guard = new WhatsAppSignatureGuard(makeConfig('', 'development'));
    const ctx = makeContext({ rawBody: BODY, header: makeValidHeader() });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('allows + logs a warning when secret is empty in test env', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const guard = new WhatsAppSignatureGuard(makeConfig('', 'test'));
    const ctx = makeContext({ rawBody: BODY, header: undefined });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('throws UnauthorizedException when secret is empty in production (fail-closed)', async () => {
    const guard = new WhatsAppSignatureGuard(makeConfig('', 'production'));
    const ctx = makeContext({ rawBody: BODY, header: makeValidHeader() });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
