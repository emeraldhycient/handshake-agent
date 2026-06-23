import type { Clock } from '../../../core/common/clock';
import type { IRateProvider, RateQuote } from './ports/rate-provider.port';
import { QuotesService } from './quotes.service';
import {
  QuoteSellOutputSchema,
  QuoteSendOutputSchema,
} from '@handshake-agent/contracts';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Stub catalog for quoteSend tests — includes networkFeeCrypto (task N1)
// ---------------------------------------------------------------------------

const STUB_CATALOG_WITH_FEES = {
  assets: {
    USDT: {
      symbol: 'USDT',
      displayName: 'USDT',
      kind: 'crypto' as const,
      decimals: 6,
      networks: ['TRON'],
      providers: {
        blockradar: { assetId: 'f56d297c-a3db-4cda-95bd-180b54679070' },
      },
      enabled: true,
    },
  },
  fiats: {
    NGN: {
      code: 'NGN',
      displayName: 'Naira',
      symbol: '₦',
      decimals: 2,
      enabled: true,
    },
  },
  networks: {
    TRON: {
      id: 'TRON',
      displayName: 'TRON (TRC-20)',
      addressPattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$',
      enabled: true,
      networkFeeCrypto: { USDT: '1' },
    },
  },
  capabilities: {
    'crypto.buy': true,
    'crypto.sell': true,
    'crypto.send': true,
    'crypto.receive': true,
    'crypto.swap': false,
  },
  sendQuoteExpiresInSec: 30,
};

function makeRegistryConfig(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'catalog') return STUB_CATALOG_WITH_FEES;
      if (key === 'sendQuoteExpiresInSec') return 30;
      return undefined;
    },
  } as unknown as ConfigService;
}

const RATE: RateQuote = {
  baseRate: 1600,
  buySpreadBps: 150,
  sellSpreadBps: 200,
  processingFeeBps: 100,
  expiresInSec: 30,
  cryptoDecimals: 6,
};

const fixedClock: Clock = {
  now: () => new Date('2026-06-18T00:00:00.000Z'),
};

describe('QuotesService.quoteBuy', () => {
  it('builds an itemized buy quote using the buy spread from the rate provider', async () => {
    const rateProvider: IRateProvider = {
      getRate: jest.fn().mockResolvedValue(RATE),
    };
    const service = new QuotesService(rateProvider, fixedClock);

    const quote = await service.quoteBuy({
      asset: 'USDT',
      fiatAmount: '100000',
      fiatCurrency: 'NGN',
    });

    expect(rateProvider.getRate).toHaveBeenCalledWith('USDT', 'NGN');
    expect(quote.asset).toBe('USDT');
    expect(quote.fiatAmount).toBe('100000');
    expect(quote.fiatCurrency).toBe('NGN');
    expect(quote.cryptoAmount).toBe('60.960591');
    // baseRate is the raw pre-spread market rate from the rate provider.
    expect(quote.baseRate).toBe('1600');
    // fxRate is the effective (buy-spread-inclusive) rate used for conversion.
    expect(quote.fxRate).toBe('1624'); // 1600 * (1 + 0.015)
    // spreadBps reports the APPLIED spread — the buy spread for a buy quote.
    expect(quote.spreadBps).toBe(150);
    expect(quote.processingFeeBps).toBe(100);
    expect(quote.expiresInSec).toBe(30);
    expect(quote.quotedAt).toBe('2026-06-18T00:00:00.000Z');
  });
});

describe('QuotesService.quoteSell', () => {
  it('builds an itemized sell quote using the sell spread (not the buy spread)', async () => {
    // User sells 100 USDT; baseRate 1600, sellSpreadBps 200, processingFeeBps 100
    // effectiveRate = round(1600 * (1 - 0.02), 6) = round(1568, 6) = 1568
    // fiatBeforeFee = 100 * 1568 = 156800
    // processingFeeAmount = round(156800 * 0.01, 2) = 1568
    // netFiat = floor(156800 - 1568, 2) = 155232
    const rateProvider: IRateProvider = {
      getRate: jest.fn().mockResolvedValue(RATE),
    };
    const service = new QuotesService(rateProvider, fixedClock);

    const quote = await service.quoteSell({
      asset: 'USDT',
      cryptoAmount: '100',
      fiatCurrency: 'NGN',
    });

    expect(rateProvider.getRate).toHaveBeenCalledWith('USDT', 'NGN');
    expect(quote.asset).toBe('USDT');
    expect(quote.cryptoAmount).toBe('100');
    expect(quote.fiatCurrency).toBe('NGN');
    expect(quote.netFiatAmount).toBe('155232');
    // baseRate is the raw pre-spread market rate from the rate provider.
    expect(quote.baseRate).toBe('1600');
    // fxRate is the effective (sell-spread-reduced) rate the user receives.
    expect(quote.fxRate).toBe('1568'); // 1600 * (1 - 0.02)
    // spreadBps reports the APPLIED spread — the sell spread for a sell quote.
    expect(quote.spreadBps).toBe(200);
    expect(quote.processingFeeBps).toBe(100);
    expect(quote.processingFeeAmount).toBe('1568');
    expect(quote.expiresInSec).toBe(30);
    expect(quote.quotedAt).toBe('2026-06-18T00:00:00.000Z');
  });

  it('sell quote reports the sell spread (200 bps), not the buy spread (150 bps)', async () => {
    const rateProvider: IRateProvider = {
      getRate: jest.fn().mockResolvedValue(RATE),
    };
    const service = new QuotesService(rateProvider, fixedClock);

    const quote = await service.quoteSell({
      asset: 'USDT',
      cryptoAmount: '100',
      fiatCurrency: 'NGN',
    });

    // Proves independence: sell quote uses sellSpreadBps (200), not buySpreadBps (150).
    expect(quote.spreadBps).toBe(200);
    expect(quote.spreadBps).not.toBe(RATE.buySpreadBps);
  });

  it('output parses against QuoteSellOutputSchema', async () => {
    const rateProvider: IRateProvider = {
      getRate: jest.fn().mockResolvedValue(RATE),
    };
    const service = new QuotesService(rateProvider, fixedClock);

    const quote = await service.quoteSell({
      asset: 'USDT',
      cryptoAmount: '50',
      fiatCurrency: 'NGN',
    });

    expect(() => QuoteSellOutputSchema.parse(quote)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// QuotesService.quoteSend (task N1)
// ---------------------------------------------------------------------------

describe('QuotesService.quoteSend', () => {
  // quoteSend does not call the rate provider — it uses the catalog network fee.
  // We pass a dummy rateProvider so the DI token is satisfied.
  const rateProvider: IRateProvider = {
    getRate: jest.fn().mockRejectedValue(new Error('should not be called')),
  };

  function makeService(): QuotesService {
    const registry = new AssetRegistry(makeRegistryConfig());
    return new QuotesService(rateProvider, fixedClock, registry);
  }

  it('returns totalDebit = cryptoAmount + networkFeeCrypto (decimal-safe, no float drift)', () => {
    const service = makeService();

    // 10.5 + 1 = 11.5 — verified with BigInt arithmetic (no float drift)
    const quote = service.quoteSend({
      asset: 'USDT',
      cryptoAmount: '10.5',
      network: 'TRON',
    });

    expect(quote.cryptoAmount).toBe('10.5');
    expect(quote.networkFeeCrypto).toBe('1');
    expect(quote.totalDebit).toBe('11.5');
  });

  it('echoes asset and network in the output', () => {
    const service = makeService();
    const quote = service.quoteSend({
      asset: 'USDT',
      cryptoAmount: '5',
      network: 'TRON',
    });

    expect(quote.asset).toBe('USDT');
    expect(quote.network).toBe('TRON');
  });

  it('stamps quotedAt from the clock and expiresInSec from config', () => {
    const service = makeService();
    const quote = service.quoteSend({
      asset: 'USDT',
      cryptoAmount: '5',
      network: 'TRON',
    });

    expect(quote.quotedAt).toBe('2026-06-18T00:00:00.000Z');
    expect(quote.expiresInSec).toBe(30);
  });

  it('handles whole-number amounts correctly (100 + 1 = 101)', () => {
    const service = makeService();
    const quote = service.quoteSend({
      asset: 'USDT',
      cryptoAmount: '100',
      network: 'TRON',
    });

    expect(quote.totalDebit).toBe('101');
    expect(quote.networkFeeCrypto).toBe('1');
  });

  it('handles a sub-unit amount (0.000001 + 1 = 1.000001)', () => {
    const service = makeService();
    const quote = service.quoteSend({
      asset: 'USDT',
      cryptoAmount: '0.000001',
      network: 'TRON',
    });

    expect(quote.totalDebit).toBe('1.000001');
  });

  it('output parses against QuoteSendOutputSchema', () => {
    const service = makeService();
    const quote = service.quoteSend({
      asset: 'USDT',
      cryptoAmount: '10',
      network: 'TRON',
    });

    expect(() => QuoteSendOutputSchema.parse(quote)).not.toThrow();
  });

  it('throws UnsupportedAssetError for an unregistered asset', () => {
    const service = makeService();

    // quoteSend is synchronous — use synchronous expect().toThrow()
    expect(() =>
      service.quoteSend({ asset: 'BTC', cryptoAmount: '1', network: 'TRON' }),
    ).toThrow();
  });

  it('throws UnsupportedNetworkError for a network not registered in the catalog', () => {
    // TRON is valid in the stub catalog — should not throw.
    const service = makeService();
    expect(() =>
      service.quoteSend({ asset: 'USDT', cryptoAmount: '1', network: 'TRON' }),
    ).not.toThrow();

    // The `network` field is validated by QuoteSendInputSchema (Zod enum) so
    // 'ETHEREUM' won't even reach the service. The service-level guard handles
    // a network that is in the enum but disabled in the catalog. We use a
    // separate QuotesService with a catalog that disables TRON:
    const disabledNetworkCatalog = {
      ...STUB_CATALOG_WITH_FEES,
      networks: {
        TRON: { ...STUB_CATALOG_WITH_FEES.networks.TRON, enabled: false },
      },
    };
    const disabledConfig = {
      get: (key: string) => {
        if (key === 'catalog') return disabledNetworkCatalog;
        return undefined;
      },
    } as unknown as ConfigService;
    const disabledRegistry = new AssetRegistry(disabledConfig);
    const disabledService = new QuotesService(
      rateProvider,
      fixedClock,
      disabledRegistry,
    );

    expect(() =>
      disabledService.quoteSend({
        asset: 'USDT',
        cryptoAmount: '1',
        network: 'TRON',
      }),
    ).toThrow();
  });

  it('throws when the asset is not supported on the given network', () => {
    // A catalog where USDT's networks list does NOT include TRON — simulates
    // an asset/network mismatch that passes Zod enum validation but fails the
    // service-level AssetRegistry check.
    const mismatchCatalog = {
      ...STUB_CATALOG_WITH_FEES,
      assets: {
        USDT: { ...STUB_CATALOG_WITH_FEES.assets.USDT, networks: [] },
      },
    };
    const mismatchConfig = {
      get: (key: string) => {
        if (key === 'catalog') return mismatchCatalog;
        return undefined;
      },
    } as unknown as ConfigService;
    const mismatchRegistry = new AssetRegistry(mismatchConfig);
    const mismatchService = new QuotesService(
      rateProvider,
      fixedClock,
      mismatchRegistry,
    );

    expect(() =>
      mismatchService.quoteSend({
        asset: 'USDT',
        cryptoAmount: '1',
        network: 'TRON',
      }),
    ).toThrow();
  });
});
