# Web Real-Data Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web app's mock read-data gateway with real JWT-authed backend endpoints (wallet balances, transaction history, deposit address, notifications, settings profile), mapping structured backend data to the existing presentation views on the frontend.

**Architecture:** Backend emits **structured** response DTOs from `@handshake-agent/contracts` (decimals, symbols, ISO timestamps, enums — never formatted strings/hex/glyphs). The FE `realGateway` fetches + `.parse()`-validates those DTOs and maps them to the existing presentation "view" shapes via a thin, unit-tested mapping layer. Components and TanStack Query hooks are unchanged. Service visibility (Tickets, Swap) is driven by `/config` capabilities. Mocks remain the default under Vitest; authenticated users run the real gateway via a `NEXT_PUBLIC_USE_MOCK=false` env override.

**Tech Stack:** NestJS 11 (clean-arch feature modules), Prisma 7, Zod via `@handshake-agent/contracts`, `nestjs-zod`; Next 16 / React 19, TanStack Query, Axios, Tailwind v4; Jest + Testcontainers (backend), Vitest + RTL (frontend).

## Global Constraints

- **Reads only.** No new money-movement. The §3.1 model-proposes/engine-disposes invariant is untouched; do not add side-effecting paths.
- **Agent has no DB access** (§3.2). New endpoints live in `presentation`/`application`/`infrastructure`; `application` must never import `@prisma/client` or `generated/prisma`. `pnpm depcruise` must stay clean.
- **Every money-moving endpoint stays server-side gated** — N/A here (reads), but all new endpoints are `@UseGuards(JwtAuthGuard)` and filter strictly by `user.userId`; 404 (never 403) for cross-user access to avoid ownership disclosure.
- **Shapes that cross FE/BE come from `@handshake-agent/contracts`** (§8) — add new DTO schemas there; never redefine in `api/` or `web/`.
- **No hardcoded config** (§7) — assets/networks/fiats/decimals/symbols/tier-limits come from the registry/ConfigService, never literals.
- **Strict TDD** (§9) — red→green→refactor, ~100% on business logic (valuation math, mapping, profile/limits). Backend integration via real Postgres (Testcontainers), not mocks.
- **Pinned values:** zod `^3.25.32`; LLM id `claude-opus-4-8` (unused here); FE Tailwind **tokens only**, no hex literals in components (data hex like `ASSET_TINTS` lives in `lib/`).
- **Capability keys (real `/config`):** `crypto.buy`, `crypto.sell`, `crypto.send`, `crypto.receive` = true; `crypto.swap` = false; **no `ticketing` key** (registry fails closed → Tickets/Swap hide automatically).
- **Valuation (D2):** holdings value = `valueAtSellRate(amount, baseRate, sellSpreadBps)` = `floor(amount × baseRate × (1 − sellSpreadBps/10000), 2)`. Spread folded in, **never** surfaced; fee-exclusive.
- **Commands:** API live = `PORT=3001 pnpm --filter @handshake-agent/api dev`. Backend unit = `pnpm --filter @handshake-agent/api test`; e2e = `pnpm --filter @handshake-agent/api test:e2e`. FE tests = `pnpm --filter @handshake-agent/web test`. Contracts tests = `pnpm --filter @handshake-agent/contracts test`. **Never run `pnpm lint`** (it runs `eslint --fix` and mutates files); verify lint with `pnpm --filter <pkg> exec eslint <files>` (no `--fix`). Boundaries: `pnpm depcruise`.
- **Do NOT commit through the pre-commit hook for docs-only changes if `lint-staged` is unresolved** — code commits should pass the hook normally (deps are installed + Prisma client generated in this worktree).

## File Structure

**Contracts (`packages/contracts/src/dto/`):**

- Create `wallet.dto.ts` — `WalletAssetBalanceSchema`, `WalletBalancesResponseSchema`, `DepositAddressResponseSchema`.
- Create `transaction.dto.ts` — `TransactionListItemSchema`, `TransactionListResponseSchema`.
- Create `notification.dto.ts` — `NotificationItemSchema`, `NotificationListResponseSchema`.
- Create `profile.dto.ts` — `ProfileLimitsSchema`, `ProfileResponseSchema`.
- Modify `index.ts` — re-export the four new files.

**Backend (`api/src/`):**

- Modify `modules/quotes/domain/quote-pricing.ts` — add pure `valueAtSellRate`.
- Modify `modules/quotes/quotes.module.ts` — export `RATE_PROVIDER`.
- Create `modules/wallets/application/wallet-balance.service.ts` — valuation + summary.
- Create `modules/wallets/presentation/wallet.controller.ts` — `GET /wallets/balances`, `GET /wallets/deposit-address`.
- Modify `modules/wallets/wallets.module.ts` — import `AuthModule` + `QuotesModule` + `CatalogModule`; register `WalletBalanceService` + `WalletController`.
- Modify `modules/transactions/application/ports/transaction.repository.port.ts` — add `findByUserId`.
- Modify `modules/transactions/infrastructure/transaction.prisma.repository.ts` — implement `findByUserId`.
- Modify `modules/chat/presentation/proposal.controller.ts` — add `GET /transactions` (list) to `TransactionStatusController`.
- Create `modules/notifications/` (port + prisma repo + service + controller + module) — `GET /notifications`.
- Create `modules/identity/presentation/profile.controller.ts` + `application/profile.service.ts` (+ any read port additions) — `GET /profile`.
- Modify `app.module.ts` — register `NotificationsModule`.

**Frontend (`web/`):**

- Create `lib/format/money.ts` — `formatFiat`/`formatCrypto` (config-driven).
- Create `lib/api/mappers/{wallet,transactions,notifications,deposit}.ts` — structured → view.
- Modify `lib/api/gateway.ts` — `realGateway` calls real endpoints + maps; `getEvents`/`getSearchCatalog` delegate to mock.
- Create `lib/api/profile.ts` + add `useProfile` to `lib/query/` — settings data.
- Create `lib/query/capabilities.ts` (`useCapabilities`) + gate Tickets/Swap in nav + quick-actions.
- Modify `components/desktop/settings-page.tsx`, `components/desktop/wallet-page.tsx`, `components/desktop/overview-page.tsx` — real profile/deposit/total.
- Create `web/.env.local` — `NEXT_PUBLIC_USE_MOCK=false`.

---

## Task 1: Wallet balances + deposit-address endpoints

**Files:**

- Create: `packages/contracts/src/dto/wallet.dto.ts`
- Test: `packages/contracts/src/dto/wallet.dto.spec.ts`
- Modify: `packages/contracts/src/dto/index.ts`
- Modify: `api/src/modules/quotes/domain/quote-pricing.ts`
- Test: `api/src/modules/quotes/domain/quote-pricing.spec.ts` (append)
- Modify: `api/src/modules/quotes/quotes.module.ts`
- Create: `api/src/modules/wallets/application/wallet-balance.service.ts`
- Test: `api/src/modules/wallets/application/wallet-balance.service.spec.ts`
- Create: `api/src/modules/wallets/presentation/wallet.controller.ts`
- Modify: `api/src/modules/wallets/wallets.module.ts`
- Test (e2e): `api/test/wallet-reads.e2e-spec.ts`

**Interfaces:**

- Consumes: `WalletService.getOrProvisionNetworkWallet(userId, network)`, `WalletService.getBalance(wallet, asset) → { amount: string; decimals: number }`; `AssetRegistry.enabledCryptoAssets()`, `.defaultCryptoAsset()`, `.defaultFiat()`, `.asset(symbol) → { symbol, displayName, decimals, networks }`, `.defaultNetworkFor(symbol)`, `.network(id) → { id, displayName }`; `IRateProvider.getRate(asset, fiat) → { baseRate, sellSpreadBps, ... }` via `RATE_PROVIDER`.
- Produces: `WalletBalancesResponse`, `DepositAddressResponse` (contracts); `valueAtSellRate(amount: string, baseRate: number, sellSpreadBps: number): string`; `WalletBalanceService.getBalances(userId): Promise<WalletBalancesResponse>` and `.getDepositAddress(userId, network?): Promise<DepositAddressResponse>`.

- [ ] **Step 1: Write the failing contract test**

`packages/contracts/src/dto/wallet.dto.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  WalletBalancesResponseSchema,
  DepositAddressResponseSchema,
} from "./wallet.dto";

describe("WalletBalancesResponseSchema", () => {
  it("parses a valid balances payload", () => {
    const ok = {
      fiatCurrency: "NGN",
      totalFiatValue: "49150.00",
      assets: [
        {
          symbol: "USDT",
          displayName: "Tether USD",
          network: "TRON",
          amount: "29.97",
          decimals: 6,
          fiatValue: "49150.00",
        },
      ],
    };
    expect(WalletBalancesResponseSchema.parse(ok)).toEqual(ok);
  });
  it("rejects a non-2dp fiat total", () => {
    expect(() =>
      WalletBalancesResponseSchema.parse({
        fiatCurrency: "NGN",
        totalFiatValue: "49150.123",
        assets: [],
      }),
    ).toThrow();
  });
});

describe("DepositAddressResponseSchema", () => {
  it("parses a valid deposit address", () => {
    const ok = {
      asset: "USDT",
      network: "TRON",
      networkLabel: "TRON (TRC-20)",
      address: "TXyz...",
    };
    expect(DepositAddressResponseSchema.parse(ok)).toEqual(ok);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `pnpm --filter @handshake-agent/contracts test -- wallet.dto`
Expected: FAIL — `Cannot find module './wallet.dto'`.

- [ ] **Step 3: Create the contract schemas**

`packages/contracts/src/dto/wallet.dto.ts`:

```ts
import { z } from "zod";
import {
  SupportedAssetSchema,
  FiatCurrencySchema,
  FiatAmountSchema,
  CryptoAmountSchema,
} from "../common";

export const WalletAssetBalanceSchema = z.object({
  symbol: SupportedAssetSchema,
  displayName: z.string(),
  network: z.string(),
  amount: CryptoAmountSchema,
  decimals: z.number().int().nonnegative(),
  fiatValue: FiatAmountSchema,
});
export type WalletAssetBalance = z.infer<typeof WalletAssetBalanceSchema>;

export const WalletBalancesResponseSchema = z.object({
  fiatCurrency: FiatCurrencySchema,
  totalFiatValue: FiatAmountSchema,
  assets: z.array(WalletAssetBalanceSchema),
});
export type WalletBalancesResponse = z.infer<
  typeof WalletBalancesResponseSchema
>;

export const DepositAddressResponseSchema = z.object({
  asset: SupportedAssetSchema,
  network: z.string(),
  networkLabel: z.string(),
  address: z.string().min(1),
  minDeposit: z.string().optional(),
});
export type DepositAddressResponse = z.infer<
  typeof DepositAddressResponseSchema
>;
```

Then add to `packages/contracts/src/dto/index.ts`:

```ts
export * from "./wallet.dto";
```

- [ ] **Step 4: Run contract test — expect PASS**

Run: `pnpm --filter @handshake-agent/contracts test -- wallet.dto`
Expected: PASS.

- [ ] **Step 5: Write the failing `valueAtSellRate` test**

Append to `api/src/modules/quotes/domain/quote-pricing.spec.ts`:

```ts
import { valueAtSellRate } from "./quote-pricing";

describe("valueAtSellRate", () => {
  it("values crypto at the sell-spread-reduced rate, floored to 2dp", () => {
    // baseRate 1650, sellSpread 200bps → effective 1617; 29.97 × 1617 = 48461.49
    expect(valueAtSellRate("29.97", 1650, 200)).toBe("48461.49");
  });
  it("returns 0.00 for a zero balance", () => {
    expect(valueAtSellRate("0", 1650, 200)).toBe("0.00");
  });
  it("throws on a non-positive base rate", () => {
    expect(() => valueAtSellRate("1", 0, 200)).toThrow();
  });
});
```

- [ ] **Step 6: Run it — expect FAIL** (`valueAtSellRate` is not exported)

Run: `pnpm --filter @handshake-agent/api test -- quote-pricing`
Expected: FAIL.

- [ ] **Step 7: Implement `valueAtSellRate`**

Append to `api/src/modules/quotes/domain/quote-pricing.ts` (reuses the file's module-private `roundTo`/`floorTo`):

```ts
/**
 * Values a crypto holding in fiat at the realizable SELL rate.
 * effectiveRate = baseRate × (1 − sellSpreadBps/10000); fee-exclusive.
 * Floored to 2 d.p. so a displayed valuation never overstates realizable value.
 */
export function valueAtSellRate(
  amount: string,
  baseRate: number,
  sellSpreadBps: number,
): string {
  const qty = Number(amount);
  if (!Number.isFinite(qty) || qty < 0) {
    throw new QuotePricingError("amount must be a non-negative number");
  }
  if (baseRate <= 0) {
    throw new QuotePricingError("baseRate must be positive");
  }
  const effectiveRate = roundTo(baseRate * (1 - sellSpreadBps / 10000), 6);
  return floorTo(qty * effectiveRate, 2).toFixed(2);
}
```

- [ ] **Step 8: Run it — expect PASS**

Run: `pnpm --filter @handshake-agent/api test -- quote-pricing`
Expected: PASS.

- [ ] **Step 9: Export `RATE_PROVIDER` from QuotesModule**

In `api/src/modules/quotes/quotes.module.ts`, add `RATE_PROVIDER` to `exports`:

```ts
  exports: [QuotesService, RATE_PROVIDER],
```

- [ ] **Step 10: Write the failing `WalletBalanceService` unit test**

`api/src/modules/wallets/application/wallet-balance.service.spec.ts`:

```ts
import { WalletBalanceService } from "./wallet-balance.service";

const makeRegistry = () => ({
  enabledCryptoAssets: () => ["USDT"],
  defaultCryptoAsset: () => "USDT",
  defaultFiat: () => "NGN",
  asset: (s: string) => ({
    symbol: s,
    displayName: "Tether USD",
    decimals: 6,
    networks: ["TRON"],
  }),
  defaultNetworkFor: () => "TRON",
  network: (id: string) => ({ id, displayName: "TRON (TRC-20)" }),
});

const wallet = {
  id: "w1",
  userId: "u1",
  network: "TRON",
  address: "TADDR",
  providerReference: "pr",
  status: "active",
};

describe("WalletBalanceService", () => {
  it("values each asset at the sell rate and sums the total", async () => {
    const wallets = {
      getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(wallet),
      getBalance: jest.fn().mockResolvedValue({ amount: "29.97", decimals: 6 }),
    };
    const rates = {
      getRate: jest
        .fn()
        .mockResolvedValue({
          baseRate: 1650,
          sellSpreadBps: 200,
          buySpreadBps: 150,
          processingFeeBps: 0,
          expiresInSec: 30,
          cryptoDecimals: 6,
        }),
    };
    const svc = new WalletBalanceService(
      wallets as any,
      makeRegistry() as any,
      rates as any,
    );

    const out = await svc.getBalances("u1");
    expect(out.fiatCurrency).toBe("NGN");
    expect(out.assets).toHaveLength(1);
    expect(out.assets[0]).toMatchObject({
      symbol: "USDT",
      network: "TRON",
      amount: "29.97",
      fiatValue: "48461.49",
    });
    expect(out.totalFiatValue).toBe("48461.49");
  });

  it("returns the deposit address for the default network", async () => {
    const wallets = {
      getOrProvisionNetworkWallet: jest.fn().mockResolvedValue(wallet),
      getBalance: jest.fn(),
    };
    const rates = { getRate: jest.fn() };
    const svc = new WalletBalanceService(
      wallets as any,
      makeRegistry() as any,
      rates as any,
    );
    const out = await svc.getDepositAddress("u1");
    expect(out).toMatchObject({
      asset: "USDT",
      network: "TRON",
      networkLabel: "TRON (TRC-20)",
      address: "TADDR",
    });
  });
});
```

- [ ] **Step 11: Run it — expect FAIL** (service not found)

Run: `pnpm --filter @handshake-agent/api test -- wallet-balance.service`
Expected: FAIL.

- [ ] **Step 12: Implement `WalletBalanceService`**

`api/src/modules/wallets/application/wallet-balance.service.ts`:

```ts
import { Inject, Injectable } from "@nestjs/common";
import type {
  FiatCurrency,
  SupportedAsset,
  WalletBalancesResponse,
  DepositAddressResponse,
} from "@handshake-agent/contracts";
import { AssetRegistry } from "../../../core/catalog/asset-registry";
import {
  RATE_PROVIDER,
  type IRateProvider,
} from "../../quotes/application/ports/rate-provider.port";
import { valueAtSellRate } from "../../quotes/domain/quote-pricing";
import { WalletService } from "./wallet.service";

/**
 * Read-only valuation/summary service for the web wallet surfaces.
 * Never moves money (§3.1) — it reads custodial balances and values them at the
 * realizable sell rate. Reaches pricing only through the IRateProvider port.
 */
@Injectable()
export class WalletBalanceService {
  constructor(
    private readonly wallets: WalletService,
    private readonly registry: AssetRegistry,
    @Inject(RATE_PROVIDER) private readonly rates: IRateProvider,
  ) {}

  async getBalances(userId: string): Promise<WalletBalancesResponse> {
    const fiat = this.registry.defaultFiat();
    const symbols = this.registry.enabledCryptoAssets();

    const assets = await Promise.all(
      symbols.map(async (symbol) => {
        const meta = this.registry.asset(symbol);
        const network = this.registry.defaultNetworkFor(symbol);
        const wallet = await this.wallets.getOrProvisionNetworkWallet(
          userId,
          network,
        );
        const { amount } = await this.wallets.getBalance(wallet, symbol);
        const rate = await this.rates.getRate(
          symbol as SupportedAsset,
          fiat as FiatCurrency,
        );
        const fiatValue = valueAtSellRate(
          amount,
          rate.baseRate,
          rate.sellSpreadBps,
        );
        return {
          symbol: symbol as SupportedAsset,
          displayName: meta.displayName,
          network,
          amount,
          decimals: meta.decimals,
          fiatValue,
        };
      }),
    );

    const totalFiatValue = assets
      .reduce((sum, a) => sum + Number(a.fiatValue), 0)
      .toFixed(2);

    return { fiatCurrency: fiat as FiatCurrency, totalFiatValue, assets };
  }

  async getDepositAddress(
    userId: string,
    network?: string,
  ): Promise<DepositAddressResponse> {
    const asset = this.registry.defaultCryptoAsset();
    const net = network ?? this.registry.defaultNetworkFor(asset);
    const netMeta = this.registry.network(net);
    const wallet = await this.wallets.getOrProvisionNetworkWallet(userId, net);
    return {
      asset: asset as SupportedAsset,
      network: net,
      networkLabel: netMeta.displayName,
      address: wallet.address,
    };
  }
}
```

- [ ] **Step 13: Run it — expect PASS**

Run: `pnpm --filter @handshake-agent/api test -- wallet-balance.service`
Expected: PASS (both cases).

- [ ] **Step 14: Create the controller and wire the module**

`api/src/modules/wallets/presentation/wallet.controller.ts`:

```ts
import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import type {
  WalletBalancesResponse,
  DepositAddressResponse,
} from "@handshake-agent/contracts";
import {
  WalletBalancesResponseSchema,
  DepositAddressResponseSchema,
} from "@handshake-agent/contracts";
import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from "../../auth/presentation/jwt-auth.guard";
import { CurrentUser } from "../../auth/presentation/current-user.decorator";
import { WalletBalanceService } from "../application/wallet-balance.service";

@Controller("wallets")
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly balances: WalletBalanceService) {}

  @Get("balances")
  async getBalances(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletBalancesResponse> {
    return WalletBalancesResponseSchema.parse(
      await this.balances.getBalances(user.userId),
    );
  }

  @Get("deposit-address")
  async getDepositAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Query("network") network?: string,
  ): Promise<DepositAddressResponse> {
    return DepositAddressResponseSchema.parse(
      await this.balances.getDepositAddress(user.userId, network),
    );
  }
}
```

In `api/src/modules/wallets/wallets.module.ts`: add `WalletController` to `controllers`, add `WalletBalanceService` to `providers`, and add imports so DI resolves — **mirror how `ChatModule` imports `AuthModule` for `JwtAuthGuard`** (the guard injects `TokenService` + `AUTH_SESSION_REPOSITORY`). Add `QuotesModule` (for `RATE_PROVIDER`) and ensure `AssetRegistry` is available (it's provided by the global `CatalogModule`; import it if not already global):

```ts
imports: [HttpModule, AuthModule, QuotesModule, CatalogModule],
controllers: [WalletController],
providers: [ /* existing */ WalletBalanceService ],
```

> If adding `AuthModule` to `imports` creates a module cycle (IdentityModule already imports WalletsModule), break it the same way ChatModule does — verify ChatModule's import list and copy that wiring. Run `pnpm depcruise` after.

- [ ] **Step 15: Run unit + depcruise — expect PASS/clean**

Run: `pnpm --filter @handshake-agent/api test -- wallet` then `pnpm depcruise`
Expected: unit PASS; depcruise clean (no `application`→`infrastructure`/prisma edges).

- [ ] **Step 16: Write the e2e (Testcontainers + JWT user)**

`api/test/wallet-reads.e2e-spec.ts` — mirror the bootstrap in `api/test/auth.e2e-spec.ts` (Testcontainers Postgres, set env before `import('../src/app.module')`, override `WALLET_PROVIDER` fake with `getBalance: () => ({ amount: '29.97', decimals: 6 })` and `provisionAddress: () => ({ address: 'TADDR...', providerReference: 'pr' })`, plus the other provider fakes from that file). Then:

```ts
// after signup → verify-email → login (access token) → kyc submit (verified):
const balances = await request(app.getHttpServer())
  .get("/wallets/balances")
  .set("Authorization", `Bearer ${accessToken}`)
  .expect(200);
expect(balances.body.fiatCurrency).toBe("NGN");
expect(balances.body.assets[0]).toMatchObject({
  symbol: "USDT",
  amount: "29.97",
});
expect(Number(balances.body.totalFiatValue)).toBeGreaterThan(0);

const deposit = await request(app.getHttpServer())
  .get("/wallets/deposit-address")
  .set("Authorization", `Bearer ${accessToken}`)
  .expect(200);
expect(deposit.body.address).toBe("TADDR...");

await request(app.getHttpServer()).get("/wallets/balances").expect(401); // no token
```

- [ ] **Step 17: Run the e2e — expect PASS**

Run: `pnpm --filter @handshake-agent/api test:e2e -- wallet-reads`
Expected: PASS (Docker daemon must be up for Testcontainers).

- [ ] **Step 18: Commit**

```bash
git add packages/contracts/src/dto/wallet.dto.ts packages/contracts/src/dto/wallet.dto.spec.ts packages/contracts/src/dto/index.ts \
  api/src/modules/quotes/domain/quote-pricing.ts api/src/modules/quotes/domain/quote-pricing.spec.ts api/src/modules/quotes/quotes.module.ts \
  api/src/modules/wallets/ api/test/wallet-reads.e2e-spec.ts
git commit -m "feat(api): wallet balances + deposit-address read endpoints (sell-rate valuation)"
```

---

## Task 2: Transactions list endpoint

**Files:**

- Create: `packages/contracts/src/dto/transaction.dto.ts`
- Test: `packages/contracts/src/dto/transaction.dto.spec.ts`
- Modify: `packages/contracts/src/dto/index.ts`
- Modify: `api/src/modules/transactions/application/ports/transaction.repository.port.ts`
- Modify: `api/src/modules/transactions/infrastructure/transaction.prisma.repository.ts`
- Modify: `api/src/modules/chat/presentation/proposal.controller.ts` (`TransactionStatusController`)
- Test (e2e): `api/test/transaction-list.e2e-spec.ts`

**Interfaces:**

- Consumes: `ITransactionRepository` (already injected in `TransactionStatusController`); `TransactionRecord { id, userId, type, status, metadata, createdAt, ... }`.
- Produces: `TransactionListResponse`; `ITransactionRepository.findByUserId(userId, opts: { limit: number; cursor?: string }): Promise<TransactionRecord[]>`.

- [ ] **Step 1: Write the failing contract test**

`packages/contracts/src/dto/transaction.dto.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TransactionListResponseSchema } from "./transaction.dto";

describe("TransactionListResponseSchema", () => {
  it("parses a list with minimal + full items", () => {
    const ok = {
      items: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          type: "buy",
          status: "completed",
          asset: "USDT",
          cryptoAmount: "29.97",
          fiatAmount: "50000",
          fiatCurrency: "NGN",
          createdAt: "2026-06-29T12:00:00.000Z",
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          type: "send",
          status: "settling",
          counterparty: "TQn9...gk7r",
          createdAt: "2026-06-29T11:00:00.000Z",
        },
      ],
      nextCursor: "2026-06-29T11:00:00.000Z",
    };
    expect(TransactionListResponseSchema.parse(ok)).toEqual(ok);
  });
  it("allows an empty list with no cursor", () => {
    expect(TransactionListResponseSchema.parse({ items: [] })).toEqual({
      items: [],
    });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @handshake-agent/contracts test -- transaction.dto`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the contract schema + barrel export**

`packages/contracts/src/dto/transaction.dto.ts`:

```ts
import { z } from "zod";

export const TransactionListItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  status: z.string(),
  asset: z.string().optional(),
  cryptoAmount: z.string().optional(),
  fiatAmount: z.string().optional(),
  fiatCurrency: z.string().optional(),
  counterparty: z.string().optional(),
  createdAt: z.string(),
});
export type TransactionListItem = z.infer<typeof TransactionListItemSchema>;

export const TransactionListResponseSchema = z.object({
  items: z.array(TransactionListItemSchema),
  nextCursor: z.string().optional(),
});
export type TransactionListResponse = z.infer<
  typeof TransactionListResponseSchema
>;
```

Append to `packages/contracts/src/dto/index.ts`: `export * from './transaction.dto'`

- [ ] **Step 4: Run contract test — expect PASS**

Run: `pnpm --filter @handshake-agent/contracts test -- transaction.dto`
Expected: PASS.

- [ ] **Step 5: Add `findByUserId` to the port**

In `api/src/modules/transactions/application/ports/transaction.repository.port.ts`, add to `interface ITransactionRepository`:

```ts
  /**
   * Lists a user's transactions newest-first for the activity feed.
   * Keyset paginated on (createdAt desc, id desc); `cursor` is the last seen
   * createdAt ISO string. Returns up to `limit` records.
   */
  findByUserId(
    userId: string,
    opts: { limit: number; cursor?: string },
  ): Promise<TransactionRecord[]>;
```

- [ ] **Step 6: Write the failing repo integration test**

Add to the existing transactions repository e2e (`api/test/transaction-repository.e2e-spec.ts` if present, else create `api/test/transaction-list-repository.e2e-spec.ts` using `startTestPostgres()` from `api/test/helpers/pg-testcontainer.ts`). Seed two transactions for a user via `prisma.transaction.create(...)` (status `completed`, metadata `{ asset:'USDT', cryptoAmount:'1', fiatAmount:'1000', fiatCurrency:'NGN' }`) and assert:

```ts
const rows = await repo.findByUserId(userId, { limit: 10 });
expect(rows).toHaveLength(2);
expect(rows[0].createdAt.getTime()).toBeGreaterThanOrEqual(
  rows[1].createdAt.getTime(),
); // desc
expect(rows.every((r) => r.userId === userId)).toBe(true);
```

- [ ] **Step 7: Run it — expect FAIL** (`findByUserId` not implemented)

Run: `pnpm --filter @handshake-agent/api test:e2e -- transaction-list-repository`
Expected: FAIL.

- [ ] **Step 8: Implement `findByUserId` in the Prisma adapter**

In `api/src/modules/transactions/infrastructure/transaction.prisma.repository.ts`, add (reuses the file's `TRANSACTION_SELECT` + `toRecord`):

```ts
  async findByUserId(
    userId: string,
    opts: { limit: number; cursor?: string },
  ): Promise<TransactionRecord[]> {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        ...(opts.cursor ? { createdAt: { lt: new Date(opts.cursor) } } : {}),
      },
      select: TRANSACTION_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit,
    })
    return rows.map(toRecord)
  }
```

- [ ] **Step 9: Run the repo test — expect PASS**

Run: `pnpm --filter @handshake-agent/api test:e2e -- transaction-list-repository`
Expected: PASS.

- [ ] **Step 10: Add `GET /transactions` to `TransactionStatusController`**

In `api/src/modules/chat/presentation/proposal.controller.ts`, add a `@Get()` method to `TransactionStatusController` that lists the current user's transactions and maps metadata fields exactly as `getStatus` does. Import `TransactionListResponse` + `TransactionListResponseSchema` from contracts. Constants: `const DEFAULT_LIMIT = 25; const MAX_LIMIT = 100;`

```ts
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ): Promise<TransactionListResponse> {
    const limit = Math.min(Math.max(Number(limitRaw) || DEFAULT_LIMIT, 1), MAX_LIMIT)
    const rows = await this.transactionRepo.findByUserId(user.userId, { limit, cursor })
    const items = rows.map((t) => {
      const meta = t.metadata
      const str = (k: string) => (typeof meta[k] === 'string' ? (meta[k] as string) : undefined)
      const counterparty = str('destination') ?? str('counterparty') ?? str('senderAddress')
      return {
        id: t.id,
        type: t.type,
        status: t.status,
        ...(str('asset') ? { asset: str('asset') } : {}),
        ...(str('cryptoAmount') ? { cryptoAmount: str('cryptoAmount') } : {}),
        ...(str('fiatAmount') ? { fiatAmount: str('fiatAmount') } : {}),
        ...(str('fiatCurrency') ? { fiatCurrency: str('fiatCurrency') } : {}),
        ...(counterparty ? { counterparty } : {}),
        createdAt: t.createdAt.toISOString(),
      }
    })
    const nextCursor = rows.length === limit ? rows[rows.length - 1].createdAt.toISOString() : undefined
    return TransactionListResponseSchema.parse({ items, ...(nextCursor ? { nextCursor } : {}) })
  }
```

Add `Query` to the `@nestjs/common` import; import `TransactionListResponse` (type) + `TransactionListResponseSchema` (value) from `@handshake-agent/contracts`.

> Route note: `@Get()` (= `GET /transactions`) and the existing `@Get(':id')` coexist without conflict in Nest.

- [ ] **Step 11: Write the list e2e**

`api/test/transaction-list.e2e-spec.ts` — mirror the auth bootstrap; after obtaining a verified user + token, seed a transaction via the injected `PrismaService` (`app.get(PrismaService)`) for that `userId`, then:

```ts
const res = await request(app.getHttpServer())
  .get("/transactions")
  .set("Authorization", `Bearer ${accessToken}`)
  .expect(200);
expect(Array.isArray(res.body.items)).toBe(true);
expect(res.body.items[0]).toMatchObject({ type: "buy", asset: "USDT" });
await request(app.getHttpServer()).get("/transactions").expect(401);
```

- [ ] **Step 12: Run e2e — expect PASS**

Run: `pnpm --filter @handshake-agent/api test:e2e -- transaction-list`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add packages/contracts/src/dto/transaction.dto.ts packages/contracts/src/dto/transaction.dto.spec.ts packages/contracts/src/dto/index.ts \
  api/src/modules/transactions/ api/src/modules/chat/presentation/proposal.controller.ts api/test/transaction-list*.e2e-spec.ts
git commit -m "feat(api): GET /transactions activity list (keyset paginated, per-user)"
```

---

## Task 3: Notifications module + endpoint

**Files:**

- Create: `packages/contracts/src/dto/notification.dto.ts`
- Test: `packages/contracts/src/dto/notification.dto.spec.ts`
- Modify: `packages/contracts/src/dto/index.ts`
- Create: `api/src/modules/notifications/application/ports/notification.repository.port.ts`
- Create: `api/src/modules/notifications/application/notifications.service.ts`
- Test: `api/src/modules/notifications/application/notifications.service.spec.ts`
- Create: `api/src/modules/notifications/infrastructure/notification.prisma.repository.ts`
- Create: `api/src/modules/notifications/presentation/notifications.controller.ts`
- Create: `api/src/modules/notifications/notifications.module.ts`
- Modify: `api/src/app.module.ts`
- Test (e2e): `api/test/notifications.e2e-spec.ts`

**Interfaces:**

- Consumes: `PrismaService` (infrastructure only); `Notification` model `{ id, userId, eventType, eventRef, templateVars, createdAt }`.
- Produces: `NotificationListResponse`; `INotificationRepository.findByUserId(userId, limit): Promise<NotificationRecord[]>`; `NotificationsService.list(userId): Promise<NotificationListResponse>`.

- [ ] **Step 1: Write the failing contract test**

`packages/contracts/src/dto/notification.dto.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NotificationListResponseSchema } from "./notification.dto";

describe("NotificationListResponseSchema", () => {
  it("parses notifications with templateVars", () => {
    const ok = {
      items: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          eventType: "transaction_completed",
          eventRef: "tx1",
          createdAt: "2026-06-29T12:00:00.000Z",
          templateVars: { asset: "USDT", amount: "29.97" },
        },
      ],
    };
    expect(NotificationListResponseSchema.parse(ok)).toEqual(ok);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @handshake-agent/contracts test -- notification.dto`
Expected: FAIL.

- [ ] **Step 3: Create the contract schema + barrel**

`packages/contracts/src/dto/notification.dto.ts`:

```ts
import { z } from "zod";

export const NotificationItemSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  eventRef: z.string(),
  createdAt: z.string(),
  templateVars: z.record(z.unknown()),
});
export type NotificationItem = z.infer<typeof NotificationItemSchema>;

export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationItemSchema),
});
export type NotificationListResponse = z.infer<
  typeof NotificationListResponseSchema
>;
```

Append to barrel: `export * from './notification.dto'`

- [ ] **Step 4: Run contract test — expect PASS**

Run: `pnpm --filter @handshake-agent/contracts test -- notification.dto`
Expected: PASS.

- [ ] **Step 5: Write the failing service unit test**

`api/src/modules/notifications/application/notifications.service.spec.ts`:

```ts
import { NotificationsService } from "./notifications.service";

describe("NotificationsService", () => {
  it("maps repo rows to the response shape", async () => {
    const repo = {
      findByUserId: jest
        .fn()
        .mockResolvedValue([
          {
            id: "11111111-1111-1111-1111-111111111111",
            eventType: "transaction_completed",
            eventRef: "tx1",
            templateVars: { amount: "1" },
            createdAt: new Date("2026-06-29T12:00:00.000Z"),
          },
        ]),
    };
    const svc = new NotificationsService(repo as any);
    const out = await svc.list("u1");
    expect(repo.findByUserId).toHaveBeenCalledWith("u1", 50);
    expect(out.items[0]).toMatchObject({
      eventType: "transaction_completed",
      createdAt: "2026-06-29T12:00:00.000Z",
    });
  });
});
```

- [ ] **Step 6: Run it — expect FAIL**

Run: `pnpm --filter @handshake-agent/api test -- notifications.service`
Expected: FAIL.

- [ ] **Step 7: Create the port, service, prisma repo, controller, module**

`api/src/modules/notifications/application/ports/notification.repository.port.ts`:

```ts
export const NOTIFICATION_REPOSITORY = Symbol("NOTIFICATION_REPOSITORY");

export interface NotificationRecord {
  id: string;
  eventType: string;
  eventRef: string;
  templateVars: Record<string, unknown>;
  createdAt: Date;
}

export interface INotificationRepository {
  findByUserId(userId: string, limit: number): Promise<NotificationRecord[]>;
}
```

`api/src/modules/notifications/application/notifications.service.ts`:

```ts
import { Inject, Injectable } from "@nestjs/common";
import type { NotificationListResponse } from "@handshake-agent/contracts";
import {
  NOTIFICATION_REPOSITORY,
  type INotificationRepository,
} from "./ports/notification.repository.port";

const DEFAULT_LIMIT = 50;

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: INotificationRepository,
  ) {}

  async list(userId: string): Promise<NotificationListResponse> {
    const rows = await this.repo.findByUserId(userId, DEFAULT_LIMIT);
    return {
      items: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        eventRef: r.eventRef,
        templateVars: r.templateVars,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
```

`api/src/modules/notifications/infrastructure/notification.prisma.repository.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../core/prisma/prisma.service";
import type {
  INotificationRepository,
  NotificationRecord,
} from "../application/ports/notification.repository.port";

@Injectable()
export class NotificationPrismaRepository implements INotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(
    userId: string,
    limit: number,
  ): Promise<NotificationRecord[]> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      select: {
        id: true,
        eventType: true,
        eventRef: true,
        templateVars: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      eventType: String(r.eventType),
      eventRef: r.eventRef,
      templateVars: (r.templateVars ?? {}) as Record<string, unknown>,
      createdAt: r.createdAt,
    }));
  }
}
```

`api/src/modules/notifications/presentation/notifications.controller.ts`:

```ts
import { Controller, Get, UseGuards } from "@nestjs/common";
import type { NotificationListResponse } from "@handshake-agent/contracts";
import { NotificationListResponseSchema } from "@handshake-agent/contracts";
import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from "../../auth/presentation/jwt-auth.guard";
import { CurrentUser } from "../../auth/presentation/current-user.decorator";
import { NotificationsService } from "../application/notifications.service";

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationListResponse> {
    return NotificationListResponseSchema.parse(
      await this.notifications.list(user.userId),
    );
  }
}
```

`api/src/modules/notifications/notifications.module.ts` — provide the port→prisma binding + service + controller, import `AuthModule` (mirror ChatModule) for the guard:

```ts
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NOTIFICATION_REPOSITORY } from "./application/ports/notification.repository.port";
import { NotificationsService } from "./application/notifications.service";
import { NotificationPrismaRepository } from "./infrastructure/notification.prisma.repository";
import { NotificationsController } from "./presentation/notifications.controller";

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: NOTIFICATION_REPOSITORY,
      useClass: NotificationPrismaRepository,
    },
  ],
})
export class NotificationsModule {}
```

Register `NotificationsModule` in `api/src/app.module.ts` `imports`.

- [ ] **Step 8: Run service unit + depcruise — expect PASS/clean**

Run: `pnpm --filter @handshake-agent/api test -- notifications.service` then `pnpm depcruise`
Expected: PASS; depcruise clean (`application` imports only the port; prisma only in `infrastructure`).

- [ ] **Step 9: Write the e2e**

`api/test/notifications.e2e-spec.ts` — bootstrap a verified user + token; seed a `Notification` row via `app.get(PrismaService).notification.create({ data: { userId, eventType: 'transaction_completed', eventRef: 'tx1', templateVars: {}, primaryChannel: 'whatsapp' } })`; then:

```ts
const res = await request(app.getHttpServer())
  .get("/notifications")
  .set("Authorization", `Bearer ${accessToken}`)
  .expect(200);
expect(res.body.items[0]).toMatchObject({
  eventType: "transaction_completed",
  eventRef: "tx1",
});
await request(app.getHttpServer()).get("/notifications").expect(401);
```

- [ ] **Step 10: Run e2e — expect PASS**

Run: `pnpm --filter @handshake-agent/api test:e2e -- notifications`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/contracts/src/dto/notification.dto.ts packages/contracts/src/dto/notification.dto.spec.ts packages/contracts/src/dto/index.ts \
  api/src/modules/notifications/ api/src/app.module.ts api/test/notifications.e2e-spec.ts
git commit -m "feat(api): notifications read module + GET /notifications (per-user feed)"
```

---

## Task 4: Settings profile endpoint

**Files:**

- Create: `packages/contracts/src/dto/profile.dto.ts`
- Test: `packages/contracts/src/dto/profile.dto.spec.ts`
- Modify: `packages/contracts/src/dto/index.ts`
- Create: `api/src/modules/identity/application/profile.service.ts`
- Test: `api/src/modules/identity/application/profile.service.spec.ts`
- Create: `api/src/modules/identity/presentation/profile.controller.ts`
- Modify: `api/src/modules/identity/identity.module.ts`
- Test (e2e): `api/test/profile.e2e-spec.ts`

**Interfaces:**

- Consumes: `AuthService.me(userId) → { userId, email, kycStatus, kycTier, hasPin }` (AuthModule, already imported by IdentityModule); `IIdentityRepository.findKycProfile(userId) → { firstName, lastName } | null` and `.findWhatsAppAddressByUserId(userId) → string | null` (token `IDENTITY_REPOSITORY`); `AssetRegistry.defaultFiat()`; `ConfigService<AppConfig, true>.get<LimitsConfig>('limits')`; `LimitsConfig = Record<string, { tier_1: TierLimits; tier_2; tier_3 }>`, `TierLimits = { perTxFiatMax; dailyFiatMax; dailyTxCountMax }`.
- Produces: `ProfileResponse`; `ProfileService.getProfile(userId): Promise<ProfileResponse>`.

- [ ] **Step 1: Write the failing contract test**

`packages/contracts/src/dto/profile.dto.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ProfileResponseSchema } from "./profile.dto";

describe("ProfileResponseSchema", () => {
  it("parses a full profile", () => {
    const ok = {
      email: "a@b.com",
      fullName: "Amara Okeke",
      phone: "+2348011112222",
      kycStatus: "verified",
      kycTier: "tier_1",
      fiatCurrency: "NGN",
      limits: {
        perTxFiatMax: 50000,
        dailyFiatMax: 200000,
        dailyTxCountMax: 10,
      },
    };
    expect(ProfileResponseSchema.parse(ok)).toEqual(ok);
  });
  it("parses an unverified profile with nulls", () => {
    const ok = {
      email: "a@b.com",
      fullName: null,
      phone: null,
      kycStatus: "not_started",
      kycTier: "unverified",
      fiatCurrency: "NGN",
      limits: null,
    };
    expect(ProfileResponseSchema.parse(ok)).toEqual(ok);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL.** `pnpm --filter @handshake-agent/contracts test -- profile.dto`

- [ ] **Step 3: Create the contract schema + barrel**

`packages/contracts/src/dto/profile.dto.ts`:

```ts
import { z } from "zod";
import { FiatCurrencySchema } from "../common";

export const ProfileLimitsSchema = z.object({
  perTxFiatMax: z.number(),
  dailyFiatMax: z.number(),
  dailyTxCountMax: z.number(),
});
export type ProfileLimits = z.infer<typeof ProfileLimitsSchema>;

export const ProfileResponseSchema = z.object({
  email: z.string().email(),
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
  kycStatus: z.string(),
  kycTier: z.string(),
  fiatCurrency: FiatCurrencySchema,
  limits: ProfileLimitsSchema.nullable(),
});
export type ProfileResponse = z.infer<typeof ProfileResponseSchema>;
```

Append to barrel: `export * from './profile.dto'`

- [ ] **Step 4: Run contract test — expect PASS.** `pnpm --filter @handshake-agent/contracts test -- profile.dto`

- [ ] **Step 5: Write the failing `ProfileService` unit test**

`api/src/modules/identity/application/profile.service.spec.ts`:

```ts
import { ProfileService } from "./profile.service";

const limitsConfig = {
  NGN: {
    tier_1: { perTxFiatMax: 50000, dailyFiatMax: 200000, dailyTxCountMax: 10 },
    tier_2: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
    tier_3: { perTxFiatMax: 1, dailyFiatMax: 1, dailyTxCountMax: 1 },
  },
};
const config = {
  get: (k: string) => (k === "limits" ? limitsConfig : undefined),
};
const registry = { defaultFiat: () => "NGN" };

describe("ProfileService", () => {
  it("composes email + name + phone + tier limits for a verified user", async () => {
    const auth = {
      me: jest
        .fn()
        .mockResolvedValue({
          userId: "u1",
          email: "a@b.com",
          kycStatus: "verified",
          kycTier: "tier_1",
          hasPin: true,
        }),
    };
    const identity = {
      findKycProfile: jest
        .fn()
        .mockResolvedValue({ firstName: "Amara", lastName: "Okeke" }),
      findWhatsAppAddressByUserId: jest
        .fn()
        .mockResolvedValue("+2348011112222"),
    };
    const svc = new ProfileService(
      auth as any,
      identity as any,
      config as any,
      registry as any,
    );
    const out = await svc.getProfile("u1");
    expect(out).toEqual({
      email: "a@b.com",
      fullName: "Amara Okeke",
      phone: "+2348011112222",
      kycStatus: "verified",
      kycTier: "tier_1",
      fiatCurrency: "NGN",
      limits: {
        perTxFiatMax: 50000,
        dailyFiatMax: 200000,
        dailyTxCountMax: 10,
      },
    });
  });
  it("returns null name/phone/limits for an unverified user", async () => {
    const auth = {
      me: jest
        .fn()
        .mockResolvedValue({
          userId: "u1",
          email: "a@b.com",
          kycStatus: "not_started",
          kycTier: "unverified",
          hasPin: false,
        }),
    };
    const identity = {
      findKycProfile: jest.fn().mockResolvedValue(null),
      findWhatsAppAddressByUserId: jest.fn().mockResolvedValue(null),
    };
    const svc = new ProfileService(
      auth as any,
      identity as any,
      config as any,
      registry as any,
    );
    const out = await svc.getProfile("u1");
    expect(out).toMatchObject({
      fullName: null,
      phone: null,
      limits: null,
      kycTier: "unverified",
    });
  });
});
```

- [ ] **Step 6: Run it — expect FAIL.** `pnpm --filter @handshake-agent/api test -- profile.service`

- [ ] **Step 7: Implement `ProfileService`**

`api/src/modules/identity/application/profile.service.ts`:

```ts
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ProfileResponse } from "@handshake-agent/contracts";
import type {
  AppConfig,
  LimitsConfig,
} from "../../../core/config/configuration";
import { AssetRegistry } from "../../../core/catalog/asset-registry";
import { AuthService } from "../../auth/application/auth.service";
import {
  IDENTITY_REPOSITORY,
  type IIdentityRepository,
} from "./ports/identity.repository.port";

const VERIFIED_TIERS = new Set(["tier_1", "tier_2", "tier_3"]);

/** Read-only profile composition for the web settings page. */
@Injectable()
export class ProfileService {
  constructor(
    private readonly auth: AuthService,
    @Inject(IDENTITY_REPOSITORY)
    private readonly identity: IIdentityRepository,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly registry: AssetRegistry,
  ) {}

  async getProfile(userId: string): Promise<ProfileResponse> {
    const me = await this.auth.me(userId);
    const [kyc, phone] = await Promise.all([
      this.identity.findKycProfile(userId),
      this.identity.findWhatsAppAddressByUserId(userId),
    ]);

    const fullName = kyc
      ? [kyc.firstName, kyc.lastName].filter(Boolean).join(" ") || null
      : null;

    const fiatCurrency = this.registry.defaultFiat();
    const limits = this.resolveLimits(me.kycTier, fiatCurrency);

    return {
      email: me.email,
      fullName,
      phone: phone ?? null,
      kycStatus: me.kycStatus,
      kycTier: me.kycTier,
      fiatCurrency: fiatCurrency as ProfileResponse["fiatCurrency"],
      limits,
    };
  }

  private resolveLimits(tier: string, fiat: string): ProfileResponse["limits"] {
    if (!VERIFIED_TIERS.has(tier)) return null;
    const limits = this.config.get<LimitsConfig>("limits");
    const fiatLimits = limits?.[fiat];
    if (!fiatLimits) return null;
    const t = fiatLimits[tier as "tier_1" | "tier_2" | "tier_3"];
    return {
      perTxFiatMax: t.perTxFiatMax,
      dailyFiatMax: t.dailyFiatMax,
      dailyTxCountMax: t.dailyTxCountMax,
    };
  }
}
```

- [ ] **Step 8: Run it — expect PASS.** `pnpm --filter @handshake-agent/api test -- profile.service`

- [ ] **Step 9: Create the controller + wire the module**

`api/src/modules/identity/presentation/profile.controller.ts`:

```ts
import { Controller, Get, UseGuards } from "@nestjs/common";
import type { ProfileResponse } from "@handshake-agent/contracts";
import { ProfileResponseSchema } from "@handshake-agent/contracts";
import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from "../../auth/presentation/jwt-auth.guard";
import { CurrentUser } from "../../auth/presentation/current-user.decorator";
import { ProfileService } from "../application/profile.service";

@Controller("profile")
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponse> {
    return ProfileResponseSchema.parse(
      await this.profile.getProfile(user.userId),
    );
  }
}
```

In `api/src/modules/identity/identity.module.ts`: add `ProfileController` to `controllers`, add `ProfileService` to `providers`. (`AuthModule` + global `ConfigService`/`AssetRegistry` are already available; `IDENTITY_REPOSITORY` is provided in this module. Confirm `AuthModule` exports `AuthService` — it must, since IdentityModule imports AuthModule; if not exported, add it to AuthModule's `exports`.)

- [ ] **Step 10: Run unit + depcruise — expect PASS/clean.** `pnpm --filter @handshake-agent/api test -- profile` then `pnpm depcruise`

- [ ] **Step 11: Write the e2e**

`api/test/profile.e2e-spec.ts` — mirror `api/test/auth.e2e-spec.ts` bootstrap. Signup (`phone: '+2348019999999'`) → verify-email (`devToken`) → login/request (`devOtp`) → login/verify (`deviceFingerprint`) → `accessToken`. Then submit KYC to populate names:

```ts
await request(app.getHttpServer())
  .post("/kyc/submit")
  .set("Authorization", `Bearer ${accessToken}`)
  .send({
    firstName: "Amara",
    lastName: "Okeke",
    nin: "12345678901",
    pin: "1234",
  }) // match KycSubmitDto shape in kyc.controller
  .expect(200);

const res = await request(app.getHttpServer())
  .get("/profile")
  .set("Authorization", `Bearer ${accessToken}`)
  .expect(200);
expect(res.body.email).toBe(email);
expect(res.body.kycTier).toBe("tier_1");
expect(res.body.fullName).toBe("Amara Okeke");
expect(res.body.limits.dailyFiatMax).toBe(200000);
expect(typeof res.body.phone === "string" || res.body.phone === null).toBe(
  true,
);
await request(app.getHttpServer()).get("/profile").expect(401);
```

> Read `api/src/modules/identity/presentation/kyc.controller.ts` for the exact `KycSubmitDto` field names before writing the submit body.

- [ ] **Step 12: Run e2e — expect PASS.** `pnpm --filter @handshake-agent/api test:e2e -- profile`

- [ ] **Step 13: Commit**

```bash
git add packages/contracts/src/dto/profile.dto.ts packages/contracts/src/dto/profile.dto.spec.ts packages/contracts/src/dto/index.ts \
  api/src/modules/identity/ api/test/profile.e2e-spec.ts
git commit -m "feat(api): GET /profile (email, name, phone, KYC tier + limits)"
```

---

## Task 5: Add `fiatSymbol` to the balances response + FE money formatter

**Files:**

- Modify: `packages/contracts/src/dto/wallet.dto.ts` (add `fiatSymbol`) + `wallet.dto.spec.ts`
- Modify: `api/src/modules/wallets/application/wallet-balance.service.ts` (fill `fiatSymbol`) + its spec
- Create: `web/lib/format/money.ts`
- Test: `web/lib/format/money.test.ts`

**Interfaces:**

- Produces: `WalletBalancesResponse.fiatSymbol: string`; `formatFiatAmount(amount: string, symbol: string, opts?: { approx?: boolean }): string`; `formatCryptoAmount(amount: string, asset: string): string`.

- [ ] **Step 1: Extend the contract — add `fiatSymbol`**

In `packages/contracts/src/dto/wallet.dto.ts`, add to `WalletBalancesResponseSchema`:

```ts
  fiatSymbol: z.string(), // display symbol for fiatCurrency, e.g. "₦" (reference data from /config)
```

Update `wallet.dto.spec.ts`'s valid payload to include `fiatSymbol: '₦'`. Run `pnpm --filter @handshake-agent/contracts test -- wallet.dto` — expect PASS.

- [ ] **Step 2: Fill `fiatSymbol` in the service + update its unit test**

In `wallet-balance.service.ts` `getBalances`, set `fiatSymbol` from the registry:

```ts
const fiatMeta = this.registry.fiat(fiat); // { symbol, decimals, ... }
// ...
return {
  fiatCurrency: fiat as FiatCurrency,
  fiatSymbol: fiatMeta.symbol,
  totalFiatValue,
  assets,
};
```

Add `fiat: (c: string) => ({ symbol: '₦', decimals: 2 })` to the `makeRegistry()` fake in `wallet-balance.service.spec.ts` and assert `out.fiatSymbol === '₦'`. Run `pnpm --filter @handshake-agent/api test -- wallet-balance.service` — expect PASS. (If Task 1 is already committed, this is a follow-up commit; otherwise fold into Task 1.)

- [ ] **Step 3: Write the failing money-formatter test**

`web/lib/format/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatFiatAmount, formatCryptoAmount } from "./money";

describe("formatFiatAmount", () => {
  it("groups thousands and drops kobo by default", () => {
    expect(formatFiatAmount("72340.00", "₦")).toBe("₦72,340");
  });
  it("prefixes ≈ when approx", () => {
    expect(formatFiatAmount("72340", "₦", { approx: true })).toBe("≈ ₦72,340");
  });
});
describe("formatCryptoAmount", () => {
  it("appends the asset symbol", () => {
    expect(formatCryptoAmount("29.97", "USDT")).toBe("29.97 USDT");
  });
});
```

- [ ] **Step 4: Run it — expect FAIL.** `pnpm --filter @handshake-agent/web test -- money`

- [ ] **Step 5: Implement the formatter**

`web/lib/format/money.ts`:

```ts
/**
 * Display formatters for money strings. Pure; deterministic (no Intl/locale —
 * mirrors the backend AssetRegistry formatter so output is identical across ICU builds).
 * The fiat symbol is passed in (sourced from the balances response / /config) — never hardcoded.
 */
function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatFiatAmount(
  amount: string,
  symbol: string,
  opts?: { approx?: boolean },
): string {
  const whole = Math.round(Number(amount)).toString();
  const out = `${symbol}${groupThousands(whole)}`;
  return opts?.approx ? `≈ ${out}` : out;
}

export function formatCryptoAmount(amount: string, asset: string): string {
  return `${amount} ${asset}`;
}
```

- [ ] **Step 6: Run it — expect PASS.** `pnpm --filter @handshake-agent/web test -- money`

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/dto/wallet.dto.ts packages/contracts/src/dto/wallet.dto.spec.ts \
  api/src/modules/wallets/application/wallet-balance.service.ts api/src/modules/wallets/application/wallet-balance.service.spec.ts \
  web/lib/format/money.ts web/lib/format/money.test.ts
git commit -m "feat(web): money formatter + fiatSymbol on balances response"
```

---

## Task 6: FE mapping layer (structured → view)

**Files:**

- Create: `web/lib/api/mappers/wallet.ts` + `web/lib/api/mappers/wallet.test.ts`
- Create: `web/lib/api/mappers/transactions.ts` + `.test.ts`
- Create: `web/lib/api/mappers/notifications.ts` + `.test.ts`
- Create: `web/lib/api/mappers/deposit.ts` + `.test.ts`

**Interfaces:**

- Consumes: contracts `WalletBalancesResponse`, `TransactionListResponse`, `NotificationListResponse`, `DepositAddressResponse`; `ASSET_TINTS` from `@/lib/constants`; `formatFiatAmount`/`formatCryptoAmount` from `@/lib/format/money`.
- Produces: `mapWalletBalances(res): BalanceView`, `mapWalletAssets(res): WalletAsset[]`, `mapTransactions(res, now?): ActivityGroup[]`, `mapNotifications(res, now?): AppNotification[]`, `mapDepositAddress(res): DepositView`.

- [ ] **Step 1: Write failing wallet-mapper tests**

`web/lib/api/mappers/wallet.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapWalletBalances, mapWalletAssets } from "./wallet";

const res = {
  fiatCurrency: "NGN",
  fiatSymbol: "₦",
  totalFiatValue: "49150.00",
  assets: [
    {
      symbol: "USDT",
      displayName: "Tether USD",
      network: "TRON",
      amount: "29.97",
      decimals: 6,
      fiatValue: "49150.00",
    },
  ],
};

describe("mapWalletBalances", () => {
  it("produces a BalanceView with approx total and per-asset rows", () => {
    const v = mapWalletBalances(res as any);
    expect(v.kind).toBe("balance");
    expect(v.total).toBe("≈ ₦49,150");
    expect(v.assets[0]).toMatchObject({
      sym: "USDT",
      name: "Tether USD",
      amount: "29.97 USDT",
      value: "₦49,150",
    });
    expect(v.assets[0].tint).toBe("#7fd1a8");
  });
});
describe("mapWalletAssets", () => {
  it("adds sub + placeholder change", () => {
    const rows = mapWalletAssets(res as any);
    expect(rows[0]).toMatchObject({
      sym: "USDT",
      sub: "USDT · TRON",
      amount: "29.97 USDT",
      value: "₦49,150",
    });
    expect(typeof rows[0].change).toBe("string");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @handshake-agent/web test -- mappers/wallet`

- [ ] **Step 3: Implement the wallet mapper**

`web/lib/api/mappers/wallet.ts`:

```ts
import type { WalletBalancesResponse } from "@handshake-agent/contracts";
import { ASSET_TINTS } from "@/lib/constants";
import { formatFiatAmount, formatCryptoAmount } from "@/lib/format/money";
import type { BalanceView, WalletAsset } from "@/lib/schemas";

// Per-asset 24h change has no backend source (no price history). Kept as a
// labelled placeholder per the product decision to keep demo values visible.
const PLACEHOLDER_CHANGE: Record<string, string> = {
  USDT: "+0.1%",
  BTC: "+2.4%",
};
const changeFor = (sym: string) => PLACEHOLDER_CHANGE[sym] ?? "—";

export function mapWalletBalances(res: WalletBalancesResponse): BalanceView {
  return {
    kind: "balance",
    total: formatFiatAmount(res.totalFiatValue, res.fiatSymbol, {
      approx: true,
    }),
    assets: res.assets.map((a) => ({
      sym: a.symbol,
      name: a.displayName,
      amount: formatCryptoAmount(a.amount, a.symbol),
      value: formatFiatAmount(a.fiatValue, res.fiatSymbol),
      tint: ASSET_TINTS[a.symbol] ?? ASSET_TINTS.USDT,
    })),
  };
}

export function mapWalletAssets(res: WalletBalancesResponse): WalletAsset[] {
  return res.assets.map((a) => ({
    sym: a.symbol,
    name: a.displayName,
    sub: `${a.symbol} · ${a.network}`,
    amount: formatCryptoAmount(a.amount, a.symbol),
    value: formatFiatAmount(a.fiatValue, res.fiatSymbol),
    change: changeFor(a.symbol),
    tint: ASSET_TINTS[a.symbol] ?? ASSET_TINTS.USDT,
  }));
}
```

- [ ] **Step 4: Run — expect PASS.** `pnpm --filter @handshake-agent/web test -- mappers/wallet`

- [ ] **Step 5: Write failing transactions-mapper test**

`web/lib/api/mappers/transactions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapTransactions } from "./transactions";

const now = new Date("2026-06-29T15:00:00.000Z");
const res = {
  items: [
    {
      id: "a",
      type: "buy",
      status: "completed",
      asset: "USDT",
      cryptoAmount: "29.97",
      fiatAmount: "50000",
      fiatCurrency: "NGN",
      createdAt: "2026-06-29T13:14:00.000Z",
    },
    {
      id: "b",
      type: "send",
      status: "settling",
      asset: "USDT",
      cryptoAmount: "26.00",
      counterparty: "TQn9YgkXgk7r",
      createdAt: "2026-06-28T10:00:00.000Z",
    },
  ],
};

describe("mapTransactions", () => {
  it("groups by day and maps dir/icon/tone", () => {
    const groups = mapTransactions(res as any, now);
    expect(groups[0].group).toBe("Today");
    expect(groups[0].items[0]).toMatchObject({
      id: "a",
      dir: "in",
      title: "Bought USDT",
      amount: "+29.97 USDT",
      status: "Completed",
      statusTone: "success",
    });
    expect(groups[1].group).toBe("Yesterday");
    expect(groups[1].items[0]).toMatchObject({
      id: "b",
      dir: "out",
      status: "Settling",
      statusTone: "warn",
    });
  });
});
```

- [ ] **Step 6: Run — expect FAIL.** `pnpm --filter @handshake-agent/web test -- mappers/transactions`

- [ ] **Step 7: Implement the transactions mapper**

`web/lib/api/mappers/transactions.ts`:

```ts
import type {
  TransactionListResponse,
  TransactionListItem,
} from "@handshake-agent/contracts";
import { formatCryptoAmount, formatFiatAmount } from "@/lib/format/money";
import type { ActivityGroup, ActivityItem, StatusTone } from "@/lib/schemas";

const FIAT_SYMBOLS: Record<string, string> = { NGN: "₦" }; // mirrors contracts FiatCurrencySchema / /config

const IN_TYPES = new Set(["buy", "receive", "deposit", "reward", "refund"]);
const OUT_TYPES = new Set(["sell", "send"]);

type Dir = ActivityItem["dir"];
function dirFor(type: string): Dir {
  if (type === "ticket_purchase") return "ticket";
  if (OUT_TYPES.has(type)) return "out";
  return IN_TYPES.has(type) || type === "swap" ? "in" : "in";
}
// Icon/colour are display data (hex permitted in lib/, root §4.2).
const DIR_STYLE: Record<Dir, { icon: string; tint: string; col: string }> = {
  in: { icon: "+", tint: "#e6f3ec", col: "#1f8a5b" },
  out: { icon: "↗", tint: "#fbeece", col: "#9a6a12" },
  ticket: { icon: "◇", tint: "#eef0fb", col: "#3b5bb5" },
};
const TITLE: Record<string, (asset?: string) => string> = {
  buy: (a) => `Bought ${a ?? "crypto"}`,
  sell: (a) => `Sold ${a ?? "crypto"}`,
  send: (a) => `Sent ${a ?? "crypto"}`,
  receive: (a) => `Received ${a ?? "crypto"}`,
  deposit: (a) => `Deposit ${a ?? ""}`.trim(),
  ticket_purchase: () => "Ticket",
};
const toneFor = (status: string): StatusTone =>
  status === "completed"
    ? "success"
    : status === "failed" || status === "rolled_back"
      ? "warn"
      : "warn";
const titleCase = (s: string) =>
  s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function groupLabel(d: Date, now: Date): string {
  if (sameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function timeLabel(d: Date) {
  return d
    .toLocaleTimeString("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase()
    .replace(" ", "");
}
function amountFor(it: TransactionListItem, sign: string): string {
  if (it.cryptoAmount && it.asset)
    return `${sign}${formatCryptoAmount(it.cryptoAmount, it.asset)}`;
  if (it.fiatAmount && it.fiatCurrency)
    return `${sign}${formatFiatAmount(it.fiatAmount, FIAT_SYMBOLS[it.fiatCurrency] ?? "")}`;
  return "";
}
function subFor(it: TransactionListItem, d: Date): string {
  const parts = [timeLabel(d)];
  if (it.counterparty)
    parts.push(
      `to ${it.counterparty.slice(0, 4)}…${it.counterparty.slice(-4)}`,
    );
  else if (it.fiatAmount && it.fiatCurrency)
    parts.push(
      formatFiatAmount(it.fiatAmount, FIAT_SYMBOLS[it.fiatCurrency] ?? ""),
    );
  return parts.join(" · ");
}

export function mapTransactions(
  res: TransactionListResponse,
  now: Date = new Date(),
): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  const byLabel = new Map<string, ActivityItem[]>();
  for (const it of res.items) {
    const d = new Date(it.createdAt);
    const dir = dirFor(it.type);
    const style = DIR_STYLE[dir];
    const sign = dir === "in" ? "+" : "-";
    const item: ActivityItem = {
      id: it.id,
      dir,
      icon: style.icon,
      tint: style.tint,
      col: style.col,
      title: (TITLE[it.type] ?? (() => titleCase(it.type)))(it.asset),
      sub: subFor(it, d),
      amount: amountFor(it, sign),
      status: titleCase(it.status),
      statusTone: toneFor(it.status),
    };
    const label = groupLabel(d, now);
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      groups.push({ group: label, items: byLabel.get(label)! });
    }
    byLabel.get(label)!.push(item);
  }
  return groups;
}
```

- [ ] **Step 8: Run — expect PASS.** `pnpm --filter @handshake-agent/web test -- mappers/transactions`

- [ ] **Step 9: Write failing notifications + deposit mapper tests**

`web/lib/api/mappers/notifications.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapNotifications } from "./notifications";
const now = new Date("2026-06-29T12:05:00.000Z");
describe("mapNotifications", () => {
  it("maps eventType to title + relative time", () => {
    const out = mapNotifications(
      {
        items: [
          {
            id: "n1",
            eventType: "transaction_completed",
            eventRef: "tx1",
            createdAt: "2026-06-29T12:00:00.000Z",
            templateVars: { asset: "USDT", amount: "29.97" },
          },
        ],
      } as any,
      now,
    );
    expect(out[0]).toMatchObject({ title: "Purchase complete", time: "5m" });
    expect(typeof out[0].sub).toBe("string");
  });
});
```

`web/lib/api/mappers/deposit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapDepositAddress } from "./deposit";
describe("mapDepositAddress", () => {
  it("maps to a DepositView with placeholders for min/eta", () => {
    const v = mapDepositAddress({
      asset: "USDT",
      network: "TRON",
      networkLabel: "TRON · TRC-20",
      address: "TADDR",
    } as any);
    expect(v).toMatchObject({
      kind: "receive",
      asset: "USDT",
      network: "TRON · TRC-20",
      address: "TADDR",
    });
    expect(typeof v.minDeposit).toBe("string");
    expect(typeof v.creditedEta).toBe("string");
  });
});
```

- [ ] **Step 10: Run — expect FAIL.** `pnpm --filter @handshake-agent/web test -- mappers/notifications mappers/deposit`

- [ ] **Step 11: Implement notifications + deposit mappers**

`web/lib/api/mappers/notifications.ts`:

```ts
import type {
  NotificationListResponse,
  NotificationItem,
} from "@handshake-agent/contracts";
import type { AppNotification } from "@/lib/schemas";

// Presentation for each notification event type (icon/title/tint are display data).
const META: Record<
  string,
  { icon: string; tint: string; col: string; title: string }
> = {
  transaction_completed: {
    icon: "+",
    tint: "#e6f3ec",
    col: "#1f8a5b",
    title: "Purchase complete",
  },
  transaction_pending: {
    icon: "↗",
    tint: "#fbeece",
    col: "#9a6a12",
    title: "Transaction pending",
  },
  transaction_failed: {
    icon: "!",
    tint: "#fbeece",
    col: "#9a6a12",
    title: "Transaction failed",
  },
  deposit_confirmed: {
    icon: "↓",
    tint: "#e6f3ec",
    col: "#1f8a5b",
    title: "Deposit confirmed",
  },
  kyc_approved: {
    icon: "✓",
    tint: "#e6f3ec",
    col: "#1f8a5b",
    title: "Identity verified",
  },
};
const DEFAULT_META = {
  icon: "•",
  tint: "#f3efe7",
  col: "#16261e",
  title: "Notification",
};

function relTime(createdAt: string, now: Date): string {
  const diffMs = now.getTime() - new Date(createdAt).getTime();
  const m = Math.max(0, Math.round(diffMs / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
function bodyFor(it: NotificationItem): string {
  const v = it.templateVars;
  if (typeof v.amount === "string" && typeof v.asset === "string")
    return `${v.amount} ${v.asset}`;
  if (typeof v.message === "string") return v.message;
  return it.eventRef;
}

export function mapNotifications(
  res: NotificationListResponse,
  now: Date = new Date(),
): AppNotification[] {
  return res.items.map((it) => {
    const meta = META[it.eventType] ?? DEFAULT_META;
    return {
      icon: meta.icon,
      tint: meta.tint,
      col: meta.col,
      title: meta.title,
      sub: bodyFor(it),
      time: relTime(it.createdAt, now),
    };
  });
}
```

`web/lib/api/mappers/deposit.ts`:

```ts
import type { DepositAddressResponse } from "@handshake-agent/contracts";
import type { DepositView } from "@/lib/schemas";

// minDeposit/creditedEta have no backend source yet — kept as labelled placeholders.
const PLACEHOLDER_MIN = "1";
const PLACEHOLDER_ETA = "~1 min";

export function mapDepositAddress(res: DepositAddressResponse): DepositView {
  return {
    kind: "receive",
    asset: res.asset,
    network: res.networkLabel,
    address: res.address,
    minDeposit: res.minDeposit
      ? `${res.minDeposit} ${res.asset}`
      : `${PLACEHOLDER_MIN} ${res.asset}`,
    creditedEta: PLACEHOLDER_ETA,
  };
}
```

- [ ] **Step 12: Run — expect PASS.** `pnpm --filter @handshake-agent/web test -- mappers`

- [ ] **Step 13: Commit**

```bash
git add web/lib/api/mappers/
git commit -m "feat(web): pure mappers from backend DTOs to presentation views"
```

---

## Task 7: Rewire `realGateway` to real endpoints + `useProfile`

**Files:**

- Modify: `web/lib/api/gateway.ts`
- Modify: `web/lib/api/gateway.test.ts` (no behaviour change expected; verify still green)
- Modify: `web/lib/api/auth.ts` (add `fetchProfile`)
- Modify: `web/lib/query/auth.ts` (add `useProfile`)
- Modify: `web/lib/query/keys.ts` (add `profile` key)

**Interfaces:**

- Consumes: the four mappers; contracts `*ResponseSchema` parsers; `api` axios instance.
- Produces: `realGateway` methods backed by real endpoints; `fetchProfile(): Promise<ProfileResponse>`; `useProfile()`.

- [ ] **Step 1: Rewrite `realGateway` data methods**

In `web/lib/api/gateway.ts`, replace the `realGateway` body's data-read methods so each fetches the contract DTO, `.parse()`-validates, and maps. Keep `getConfig`, `createQuote`, `executeTransaction` unchanged. Delegate `getEvents`/`getSearchCatalog` to `mock` (no backend yet):

```ts
import {
  WalletBalancesResponseSchema,
  DepositAddressResponseSchema,
  TransactionListResponseSchema,
  NotificationListResponseSchema,
} from "@handshake-agent/contracts";
import { mapWalletBalances, mapWalletAssets } from "./mappers/wallet";
import { mapTransactions } from "./mappers/transactions";
import { mapNotifications } from "./mappers/notifications";
import { mapDepositAddress } from "./mappers/deposit";
// ...
const realGateway: Gateway = {
  async getConfig() {
    const { data } = await api.get("/config");
    return PublicConfigResponseSchema.parse(data);
  },
  async getBalances() {
    const r = WalletBalancesResponseSchema.parse(
      (await api.get("/wallets/balances")).data,
    );
    return mapWalletBalances(r);
  },
  async getWalletAssets() {
    const r = WalletBalancesResponseSchema.parse(
      (await api.get("/wallets/balances")).data,
    );
    return mapWalletAssets(r);
  },
  async getActivity() {
    const r = TransactionListResponseSchema.parse(
      (await api.get("/transactions")).data,
    );
    return mapTransactions(r);
  },
  async getDepositAddress() {
    const r = DepositAddressResponseSchema.parse(
      (await api.get("/wallets/deposit-address")).data,
    );
    return mapDepositAddress(r);
  },
  async getNotifications() {
    const r = NotificationListResponseSchema.parse(
      (await api.get("/notifications")).data,
    );
    return mapNotifications(r);
  },
  // Not yet backed by a real endpoint — ticketing is deferred and hidden via /config capabilities:
  getEvents: mock.getEvents,
  getSearchCatalog: mock.getSearchCatalog,
  createQuote: realGatewayCreateQuote, // keep existing impl
  executeTransaction: realGatewayExecute, // keep existing impl
};
```

> Keep the existing `createQuote`/`executeTransaction` real implementations exactly as they are (chat flow is already live). Remove the now-unused view-schema imports (`BalanceViewSchema`, etc.) from `gateway.ts` and the `z`/`WalletAssetSchema` usages that the rewrite drops; verify with `pnpm --filter @handshake-agent/web exec eslint lib/api/gateway.ts` (no `--fix`).

- [ ] **Step 2: Run the gateway test — expect PASS (still mock by default)**

Run: `pnpm --filter @handshake-agent/web test -- api/gateway`
Expected: PASS — Vitest sets no `NEXT_PUBLIC_USE_MOCK`, so `gateway === mockGateway`; the deep-equal-with-mock test is unaffected.

- [ ] **Step 3: Add `fetchProfile` + `useProfile` + query key**

In `web/lib/api/auth.ts` add:

```ts
import {
  ProfileResponseSchema,
  type ProfileResponse,
} from "@handshake-agent/contracts";
export async function fetchProfile(): Promise<ProfileResponse> {
  const { data } = await api.get("/profile");
  return ProfileResponseSchema.parse(data);
}
```

In `web/lib/query/keys.ts` add `profile: ['auth', 'profile'] as const,`.
In `web/lib/query/auth.ts` add:

```ts
export function useProfile() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: qk.profile,
    queryFn: fetchProfile,
    enabled: !!accessToken,
    staleTime: 60_000,
  });
}
```

(Import `fetchProfile` alongside the existing `fetchMe` import.)

- [ ] **Step 4: Typecheck — expect PASS.** `pnpm --filter @handshake-agent/web typecheck`

- [ ] **Step 5: Commit**

```bash
git add web/lib/api/gateway.ts web/lib/api/gateway.test.ts web/lib/api/auth.ts web/lib/query/auth.ts web/lib/query/keys.ts
git commit -m "feat(web): wire realGateway to backend read endpoints + useProfile"
```

---

## Task 8: Capability-driven visibility (hide Tickets + Swap)

**Files:**

- Create: `web/lib/query/capabilities.ts` + `web/lib/query/capabilities.test.tsx`
- Modify: `web/components/desktop/dashboard-sidebar.tsx` (filter Tickets)
- Modify: `web/components/mobile/wallet-tab.tsx` + `web/components/desktop/overview-page.tsx` + `web/components/desktop/wallet-page.tsx` (filter Swap quick-action)

**Interfaces:**

- Consumes: `useConfig()` → `PublicConfigResponse.capabilities` (`Record<string, boolean>`).
- Produces: `useCapabilities()` → `{ has(key: string): boolean; canSwap: boolean; canTickets: boolean }`.

- [ ] **Step 1: Write the failing hook test**

`web/lib/query/capabilities.test.tsx` — render `useCapabilities` with a QueryClient whose `config` query is pre-seeded; assert `canSwap === false` when `crypto.swap` is false and `canTickets === false` when `ticketing` is absent. (Mirror `web/lib/query/hooks.config.test.tsx` for the QueryClient harness.)

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @handshake-agent/web test -- capabilities`

- [ ] **Step 3: Implement `useCapabilities`**

`web/lib/query/capabilities.ts`:

```ts
import { useConfig } from "./hooks";

/** Effective capability flags from /config. Fail-closed: unknown/loading → false. */
export function useCapabilities() {
  const { data } = useConfig();
  const caps = data?.capabilities ?? {};
  const has = (key: string) => caps[key] === true;
  return { has, canSwap: has("crypto.swap"), canTickets: has("ticketing") };
}
```

- [ ] **Step 4: Run — expect PASS.** `pnpm --filter @handshake-agent/web test -- capabilities`

- [ ] **Step 5: Gate Tickets in the desktop sidebar**

In `web/components/desktop/dashboard-sidebar.tsx`, filter `NAV_ITEMS` by capability. Import `useCapabilities`; inside the component:

```ts
const { canTickets } = useCapabilities();
const items = NAV_ITEMS.filter((i) => i.page !== "tickets" || canTickets);
```

Render `items` instead of `NAV_ITEMS`. (Mobile tabbar has no Tickets tab — no change there.)

- [ ] **Step 6: Gate the Swap quick-action**

In `web/components/mobile/wallet-tab.tsx`, `web/components/desktop/overview-page.tsx`, and `web/components/desktop/wallet-page.tsx`, hide the Swap action when `!canSwap`:

```ts
const { canSwap } = useCapabilities();
// where the actions array is mapped, filter swap:
const actions = QUICK_ACTIONS.filter((a) => a.action !== "swap" || canSwap);
```

For `wallet-page.tsx` (hardcoded buttons), wrap the Swap `<Button>` in `{canSwap && (...)}`.

- [ ] **Step 7: Update existing component tests + run FE suite**

Update any snapshot/visibility test that asserted a Swap button or Tickets nav item by default (config mock has `crypto.swap:false`, no `ticketing` → both hidden). Run: `pnpm --filter @handshake-agent/web test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/lib/query/capabilities.ts web/lib/query/capabilities.test.tsx \
  web/components/desktop/dashboard-sidebar.tsx web/components/mobile/wallet-tab.tsx \
  web/components/desktop/overview-page.tsx web/components/desktop/wallet-page.tsx
git commit -m "feat(web): drive Tickets + Swap visibility from /config capabilities"
```

---

## Task 9: Real Settings page + deposit panel + overview total

**Files:**

- Modify: `web/components/desktop/settings-page.tsx`
- Modify: `web/components/desktop/wallet-page.tsx` (deposit panel → `useDepositAddress`)
- Modify: `web/components/desktop/overview-page.tsx` (hero total → `useBalances`)
- Modify/Create: `web/components/desktop/settings-page.test.tsx`

**Interfaces:**

- Consumes: `useProfile()`, `useDepositAddress()`, `useBalances()`.

- [ ] **Step 1: Write the failing settings test (four branches)**

In `web/components/desktop/settings-page.test.tsx`, mock `@/lib/query/auth` `useProfile` to return loading, error, and data (`{ email, fullName, phone, kycTier: 'tier_1', limits: { dailyFiatMax: 200000, ... } }`). Assert: loading shows skeletons; error shows the error copy; data shows `fullName` (or email when null), the masked/real phone, a "tier_1" badge, and the formatted daily limit. (Mirror the existing desktop page tests for the RTL + QueryClient harness.)

- [ ] **Step 2: Run — expect FAIL.** `pnpm --filter @handshake-agent/web test -- settings-page`

- [ ] **Step 3: Rewrite `settings-page.tsx` to consume `useProfile`**

Replace the hardcoded profile card + tier-limit values with `useProfile()` data and four branches (loading skeleton / error / empty→still render email / data). Display name = `profile.fullName ?? profile.email`; show `profile.phone` only when non-null; KYC badge = `profile.kycTier`; daily limit = `formatFiatAmount(String(profile.limits.dailyFiatMax), '₦')` when `limits` present (hide the limit row when `limits === null`). Keep the PIN "Change" + Face-ID toggle as UI-only controls. Use the existing `Money`/format helpers; tokens only.

- [ ] **Step 4: Run settings test — expect PASS.** `pnpm --filter @handshake-agent/web test -- settings-page`

- [ ] **Step 5: Deposit panel uses `useDepositAddress`**

In `web/components/desktop/wallet-page.tsx`, replace the `DEPOSIT_ADDRESS` constant usage with `useDepositAddress()`; render the address from `deposit.data?.address`, the network label from `deposit.data?.network`, with loading/error handling on that panel (skeleton while loading, keep the QR placeholder). Drop the `DEPOSIT_ADDRESS` import.

- [ ] **Step 6: Overview hero uses real total**

In `web/components/desktop/overview-page.tsx`, replace the hardcoded `<Money value="₦72,340.00" />` with `balanceData?.total`. Keep the "+₦1,210 (1.7%) today · ≈ $43.50" line as a labelled placeholder (no backend source — product decision). Keep the asset-table Price/24h `—` placeholders.

- [ ] **Step 7: Run the full FE suite + typecheck — expect PASS**

Run: `pnpm --filter @handshake-agent/web test && pnpm --filter @handshake-agent/web typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/components/desktop/settings-page.tsx web/components/desktop/settings-page.test.tsx \
  web/components/desktop/wallet-page.tsx web/components/desktop/overview-page.tsx
git commit -m "feat(web): real settings (profile+limits), live deposit address, real overview total"
```

---

## Task 10: Flip mock off for authed users + live verification

**Files:**

- Create: `web/.env.local`
- (No source changes — verification only.)

- [ ] **Step 1: Set the env override**

Create `web/.env.local` (gitignored — confirm it's in `.gitignore`):

```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
NEXT_PUBLIC_USE_MOCK=false
```

> The code default stays `true` so Vitest (no env) keeps using the mock — do NOT change the default in `gateway.ts`.

- [ ] **Step 2: Start the backend + web, log in as a KYC-verified user**

Backend: `PORT=3001 pnpm --filter @handshake-agent/api dev` (dev Postgres :5544 + Redis :6379 up). Web via preview tooling (`:3000`). With `AUTH_DEV_EXPOSE_OTP=true` in the API env, complete signup → verify-email → login → KYC submit in the browser to reach a verified session.

- [ ] **Step 3: Verify each surface live (browser)**

Using the preview tools, confirm with the logged-in verified user:

- Mobile **wallet tab**: total + USDT row render from `/wallets/balances` (network tab shows the real call; value is the sell-rate valuation).
- Mobile **activity tab** + desktop **activity page**: rows from `/transactions` (empty-state for a fresh user is acceptable and expected).
- Desktop **overview**: real total in the hero.
- Desktop **wallet page**: real deposit address in the panel; **Swap** action hidden (capability false); **Tickets** nav item hidden.
- Desktop **settings**: real email, name (if KYC submitted), phone (if present), tier badge, daily limit.
- Notifications feed (bell): renders from `/notifications` (empty-state acceptable).
  Capture screenshots of the wallet + settings surfaces.

- [ ] **Step 4: Full gate sweep (independent verification)**

Run each gate yourself and confirm output (do not trust a prior "green"):

```bash
pnpm --filter @handshake-agent/contracts test
pnpm --filter @handshake-agent/api test
pnpm --filter @handshake-agent/api test:e2e
pnpm --filter @handshake-agent/web test
pnpm --filter @handshake-agent/web typecheck
pnpm depcruise
```

Expected: all green; depcruise clean.

- [ ] **Step 5: Commit any verification fixups + finalize**

```bash
git add -A
git commit -m "chore(web): enable real gateway for authed users (.env.local) + verification"
```

---

## Self-Review

**Spec coverage:**

- §5.1 wallet balances → Task 1; §5.2 deposit address → Task 1; §5.3 transactions list → Task 2; §5.4 notifications → Task 3; §5.5 profile → Task 4; §5.6 capabilities → Task 8. ✓
- §6.1 mappers → Task 6; money format → Task 5; §6.2 gateway → Task 7; §6.3 capability gating → Task 8; §6.4 page edits (settings/wallet/overview) → Task 9; deposit wiring → Task 9. ✓
- §6.5 env → Task 10; §4/D6 mock-default-stays-true → Tasks 7 & 10. ✓
- §7 testing: contracts parse tests (Tasks 1–5), backend unit+e2e (1–4), FE Vitest (5–9), live (10). ✓
- D2 valuation fee-exclusive → Task 1 `valueAtSellRate`; D3 keep placeholders → Tasks 6 (change), 9 (today delta, Price/24h), 6 (deposit min/eta); D5 name/phone when present → Task 4. ✓

**Type consistency:** `WalletBalancesResponse` (with `fiatSymbol` added in Task 5) consumed by mappers in Task 6 and gateway in Task 7; `ProfileResponse` produced in Task 4, consumed by `fetchProfile`/`useProfile` in Task 7 and settings in Task 9; mapper names (`mapWalletBalances`/`mapWalletAssets`/`mapTransactions`/`mapNotifications`/`mapDepositAddress`) are identical across Tasks 6–7. ✓

**Placeholder scan:** no TBD/TODO; unbacked display values are explicit, labelled constants per the product decision (not plan placeholders). ✓

**Open execution notes (verify while implementing, don't block the plan):**

- Confirm `AuthModule` exports `AuthService` (Task 4) and that adding `AuthModule`/`QuotesModule` to `WalletsModule` imports introduces no module cycle (Task 1) — mirror ChatModule's wiring and re-run `pnpm depcruise`.
- Confirm the exact `KycSubmitDto` field names before writing the Task 4 e2e KYC-submit body.
- Confirm `web/.env.local` is gitignored (Task 10).
