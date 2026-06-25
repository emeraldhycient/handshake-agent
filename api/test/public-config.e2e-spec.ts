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
import type { CatalogConfig } from '../src/core/config/configuration';
import { AssetRegistry } from '../src/core/catalog/asset-registry';
import { PublicConfigController } from '../src/modules/config/presentation/public-config.controller';
import type { PublicConfigResponse } from '@handshake-agent/contracts';

// ---------------------------------------------------------------------------
// Lightweight ConfigService stub — mirrors wallet-backfill.e2e-spec.ts.
// Reads directly from the JSON defaults so we avoid the Zod env-schema that
// requires DATABASE_URL / external provider keys not needed here.
// ---------------------------------------------------------------------------

function makeConfigService(overrides?: { catalog?: CatalogConfig }) {
  const defaults = configuration() as unknown as Record<string, unknown>;
  const merged = overrides
    ? { ...defaults, catalog: overrides.catalog ?? defaults['catalog'] }
    : defaults;
  return {
    get: <T>(key: string): T | undefined => {
      const parts = key.split('.');
      // Try top-level key first, then dotted path
      let val: unknown = key in merged ? merged[key] : undefined;
      if (val === undefined && parts.length > 1) {
        let node: unknown = merged;
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
    // amlBlockchain and providers are also internal/infra fields — must never leak
    expect(serialized).not.toContain('amlBlockchain');
    expect(serialized).not.toContain('providers');
  });

  // -------------------------------------------------------------------------
  // Enabled-only filtering contract
  //
  // Build a catalog that has one DISABLED asset (BTC) and one enabled asset
  // (USDT), plus one DISABLED network (ETH) and one enabled network (TRON).
  // The endpoint must only expose enabled entries — disabled ones must be
  // absent from the response entirely.
  // -------------------------------------------------------------------------

  it('omits disabled assets and networks from the response', async () => {
    // configuration() returns the full AppConfig; we only need the catalog section.
    const baseConfig = configuration() as { catalog: CatalogConfig };

    // Construct a catalog with a disabled asset (BTC) and a disabled network (ETH)
    // alongside the existing enabled entries (USDT / TRON).
    const catalogWithDisabled: CatalogConfig = {
      ...baseConfig.catalog,
      assets: {
        ...baseConfig.catalog.assets,
        BTC: {
          symbol: 'BTC',
          displayName: 'Bitcoin',
          kind: 'crypto',
          decimals: 8,
          networks: ['TRON'],
          providers: { blockradar: { assetId: 'btc-provider-id-secret' } },
          enabled: false, // DISABLED — must not appear in /config
        },
      },
      networks: {
        ...baseConfig.catalog.networks,
        ETH: {
          id: 'ETH',
          displayName: 'Ethereum (ERC-20)',
          addressPattern: '^0x[0-9a-fA-F]{40}$',
          enabled: false, // DISABLED — must not appear in /config
          networkFeeCrypto: { USDT: '2' },
          amlBlockchain: 'ethereum',
        },
      },
    };

    const configService = makeConfigService({ catalog: catalogWithDisabled });
    const assetRegistry = new AssetRegistry(configService as never);

    const moduleRef = await Test.createTestingModule({
      controllers: [PublicConfigController],
      providers: [{ provide: AssetRegistry, useValue: assetRegistry }],
    }).compile();

    const disabledApp = moduleRef.createNestApplication();
    await disabledApp.init();

    try {
      const res = await request(disabledApp.getHttpServer())
        .get('/config')
        .expect(200);
      const body = res.body as PublicConfigResponse;
      const serialized = JSON.stringify(body);

      // Enabled entries are present
      expect(body.assets.map((a) => a.symbol)).toContain('USDT');
      expect(body.networks.map((n) => n.id)).toContain('TRON');

      // Disabled entries are absent — neither their symbol/id nor any of their
      // secret fields (e.g. the provider assetId we seeded) should appear
      expect(body.assets.map((a) => a.symbol)).not.toContain('BTC');
      expect(body.networks.map((n) => n.id)).not.toContain('ETH');
      expect(serialized).not.toContain('btc-provider-id-secret');
      expect(serialized).not.toContain('Ethereum (ERC-20)');
    } finally {
      await disabledApp.close();
    }
  });
});
