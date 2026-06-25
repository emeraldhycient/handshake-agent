/**
 * Task 15 — GET /config e2e test (DB-FREE, no Testcontainers).
 *
 * The /config endpoint is backed purely by AssetRegistry (config-driven, no
 * Prisma/DB). The harness bootstraps a minimal Nest app by registering the
 * controller and its dependency (AssetRegistry) directly in the root testing
 * module — the approach used throughout this codebase for lightweight unit/
 * integration controller tests.
 *
 * Harness pattern:
 *   - AssetRegistry instantiated directly with a lightweight ConfigService stub
 *     (reads JSON defaults; same pattern as wallet-backfill.e2e-spec.ts)
 *   - PublicConfigController registered directly in the root testing module
 *     (avoids NestJS import-scope DI issues without the full AppModule)
 *
 * TDD: the test is written BEFORE the controller exists → initial run is a
 * compile error. Implementing the controller makes it go green.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import configuration from '../src/core/config/configuration';
import { AssetRegistry } from '../src/core/catalog/asset-registry';
import { PublicConfigController } from '../src/modules/config/presentation/public-config.controller';
import type { PublicConfigResponse } from '@handshake-agent/contracts';

// ---------------------------------------------------------------------------
// Lightweight ConfigService stub — mirrors wallet-backfill.e2e-spec.ts.
// Reads directly from the JSON defaults so we avoid the Zod env-schema that
// requires DATABASE_URL / external provider keys not needed here.
// ---------------------------------------------------------------------------

function makeConfigService() {
  const defaults = configuration() as unknown as Record<string, unknown>;
  return {
    get: <T>(key: string): T | undefined => {
      const parts = key.split('.');
      // Try top-level key first, then dotted path
      let val: unknown = key in defaults ? defaults[key] : undefined;
      if (val === undefined && parts.length > 1) {
        let node: unknown = defaults;
        for (const part of parts) {
          node = (node as Record<string, unknown>)?.[part];
        }
        val = node;
      }
      return val as T;
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('GET /config (public catalog endpoint)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Instantiate AssetRegistry directly — it is a plain class with one
    // constructor param (ConfigService). No framework coupling beyond the DI
    // decorator, so instantiation outside a full Nest context is safe.
    const configService = makeConfigService();
    const assetRegistry = new AssetRegistry(configService as never);

    const moduleRef = await Test.createTestingModule({
      controllers: [PublicConfigController],
      providers: [
        // Provide the real AssetRegistry instance populated from JSON defaults.
        { provide: AssetRegistry, useValue: assetRegistry },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 200 with the non-secret catalog', async () => {
    const res = await request(app.getHttpServer()).get('/config').expect(200);
    const body = res.body as PublicConfigResponse;

    // fiats contains NGN with its symbol
    expect(body.fiats).toEqual([
      expect.objectContaining({ code: 'NGN', symbol: '₦' }),
    ]);

    // first asset is USDT
    expect(body.assets[0].symbol).toBe('USDT');

    // networks contains TRON
    expect(body.networks).toEqual([expect.objectContaining({ id: 'TRON' })]);

    // capabilities record is present
    expect(body.capabilities).toBeDefined();
    expect(typeof body.capabilities['crypto.buy']).toBe('boolean');

    // NO secrets in serialized output
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('masterWalletId');
    expect(serialized).not.toContain('assetId');
    expect(serialized).not.toContain('addressPattern');
    expect(serialized).not.toContain('networkFeeCrypto');
  });
});
