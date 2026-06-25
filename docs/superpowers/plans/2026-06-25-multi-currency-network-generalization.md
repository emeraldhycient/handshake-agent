# Multi-currency / multi-network generalization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make fiat currency (and the last network/asset literals) a _value threaded through the engine and resolved from config_, never a hardcoded `'NGN'`/`'TRON'` — so adding a market becomes a catalog/config entry + one enum line, with zero money-path code changes.

**Architecture:** Mirror the WN-4 `asset`-threading pattern for `fiatCurrency`: add it to each money-carrying input shape, destructure it, and use it in place of every `'NGN'` literal. Make pricing `baseRate`, KYC tier limits, the Travel-Rule threshold, and velocity counters **per-fiat** (keyed by catalog fiat `code`). Keep the Zod/Prisma enums **narrow and fail-closed** — only NGN/TRON/USDT remain _allowed_, but no code path assumes them. Crypto-only flows (send/swap) gate against a registry-resolved **base fiat**.

**Tech Stack:** NestJS 11 (tsc, Express 5), Prisma 7 (`prisma-client` generator → `api/generated/prisma`), Zod ^3.25.32 shared contracts (`@handshake-agent/contracts`), Jest + `@nestjs/testing` + `@testcontainers/postgresql`, Next 16 + TanStack Query + Vitest.

## Global Constraints

- **Enums stay narrow & fail-closed.** Do NOT loosen `FiatCurrencySchema`/`NetworkSchema`/`SupportedAssetSchema` to `z.string()`. Adding a market = an additive enum entry + catalog/config entry. (root §3.6, §7; contracts CLAUDE.md "explicit, additive enum growth".)
- **No new market enabled.** JSON defaults ship NGN/TRON/USDT only. No new FX feed, provider, or compliance work.
- **No hardcoded money values.** New tunables → JSON defaults (`api/src/core/config/configuration.ts`) per §7. Never inline.
- **Shapes that cross FE/BE come from `@handshake-agent/contracts`** (§8). Validate at boundaries (`.parse()`).
- **Strict TDD** (root §9): red → green → refactor; ~100% coverage on touched domain/application/engine code.
- **Money as decimal strings** until the execution boundary; never round-trip through float (existing `toScaled`/`fromScaled` in `ledger.ts`).
- **The agent never touches the DB** (§3.2): the `/config` endpoint and prompt read via `AssetRegistry`/config, not Prisma.
- **Conventional Commits**, scope ∈ `[api, web, contracts, agent, config, ci, deps, repo, docs]`, header ≤ 100 chars. One coherent change per commit.
- **Behavior is identical at launch.** NGN flows through unchanged; existing NGN test fixtures must stay green.
- Verify each phase yourself: `pnpm --filter @handshake-agent/api test`, `pnpm typecheck`, `pnpm depcruise` (re-run independently; implementers over-report green).

---

## File Structure

**Contracts** (`packages/contracts/src/`)

- `dto/buy-order.dto.ts` — add `fiatCurrency` to `CreateBuyOrderResponseSchema`.
- `dto/config.dto.ts` _(new)_ — `PublicConfigResponseSchema` for the `/config` endpoint.
- `dto/index.ts` — export the new DTO.

**API domain/application** (`api/src/`)

- `modules/transactions/domain/ledger.ts` — thread `fiatCurrency` into `BuildBuyLedgerInput`/`BuildSellFinalizeInput` + their builders; fix JSDoc.
- `modules/transactions/application/ports/settlement.repository.port.ts` — add `fiatCurrency` to `SettleBuyAtomicInput`/`SettleSellFinalizeInput`; fix JSDoc.
- `modules/transactions/application/execution.service.ts` — replace 10 `'NGN'` literals + 2 `'TRON'` fallbacks with threaded values / fail-closed.
- `modules/transactions/application/proposal.service.ts` — per-fiat `baseRates` + per-fiat travel-rule; base-fiat for send.
- `modules/identity/application/kyc-gate.service.ts` — per-fiat tier limits; thread `fiatCurrency`.
- `modules/quotes/infrastructure/config-rate.provider.ts` — resolve `baseRates[fiatCurrency]`.
- `core/config/configuration.ts` — `AssetPricing.baseRates`, `LimitsConfig` per-fiat, `ComplianceConfig.travelRuleThresholds`; JSON defaults.
- `core/catalog/asset-registry.ts` — add `defaultFiat()`.
- `modules/agent/infrastructure/anthropic-llm.provider.ts` — render prompt basket from `AssetRegistry`.

**API infrastructure**

- `prisma/schema/01-audit.prisma` — `VelocityCounter.fiatCurrency` + compound unique.
- `prisma/migrations/<ts>_velocity_per_currency/migration.sql` _(new)_.
- `modules/transactions/infrastructure/transaction.prisma.repository.ts` + `…/settlement.prisma.repository.ts` — currency in velocity upserts.
- `modules/identity/infrastructure/velocity.prisma.repository.ts` — currency in `getDailyUsage`.
- `modules/transactions/application/ports/transaction.repository.port.ts` — `VelocityIncrementData.fiatCurrency`.
- `modules/identity/application/ports/velocity.repository.port.ts` — `getDailyUsage` currency arg.

**API presentation** (`/config`)

- `modules/config/presentation/public-config.controller.ts` _(new)_ + `modules/config/config.module.ts` _(new)_.

**Web** (`web/`)

- `lib/api/gateway.ts` + `lib/api/types` — `getConfig`.
- `lib/query/keys.ts` + `lib/query/hooks.ts` — `qk.config`, `useConfig`.
- `lib/constants.ts` — drive supported basket from config.

---

## Phase 0 — Contracts gap

### Task 1: Add `fiatCurrency` to `CreateBuyOrderResponseSchema`

**Files:**

- Modify: `packages/contracts/src/dto/buy-order.dto.ts`
- Test: `packages/contracts/src/dto/buy-order.dto.spec.ts` (create if absent)

**Interfaces:**

- Produces: `CreateBuyOrderResponseSchema` now includes `fiatCurrency: FiatCurrencySchema`.

- [ ] **Step 1: Write the failing test**

```ts
import { CreateBuyOrderResponseSchema } from "./buy-order.dto";

describe("CreateBuyOrderResponseSchema", () => {
  it("carries fiatCurrency so the order response threads the currency", () => {
    const parsed = CreateBuyOrderResponseSchema.parse({
      orderId: "11111111-1111-1111-1111-111111111111",
      status: "pending",
      asset: "USDT",
      fiatCurrency: "NGN",
      cryptoAmount: "3.06",
      createdAt: "2026-06-25T00:00:00.000Z",
    });
    expect(parsed.fiatCurrency).toBe("NGN");
  });

  it("rejects a response missing fiatCurrency", () => {
    expect(() =>
      CreateBuyOrderResponseSchema.parse({
        orderId: "11111111-1111-1111-1111-111111111111",
        status: "pending",
        asset: "USDT",
        cryptoAmount: "3.06",
        createdAt: "2026-06-25T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm --filter @handshake-agent/contracts test buy-order` → FAIL (`fiatCurrency` accepted as missing / undefined on parsed).

- [ ] **Step 3: Implement** — add the field, importing `FiatCurrencySchema`:

```ts
import { z } from "zod";
import {
  FiatCurrencySchema,
  IdempotencyKeySchema,
  SupportedAssetSchema,
} from "../common";
import { QuoteBuyInputSchema } from "../tools/quote-buy.tool";

// …request schema unchanged…

export const CreateBuyOrderResponseSchema = z.object({
  orderId: z.string().uuid(),
  status: BuyOrderStatusSchema,
  asset: SupportedAssetSchema,
  fiatCurrency: FiatCurrencySchema,
  cryptoAmount: z.string(),
  createdAt: z.string().datetime(),
});
```

- [ ] **Step 4: Run test to verify it passes** — same command → PASS.

- [ ] **Step 5: Update the BE response builder.** Grep the api for where `CreateBuyOrderResponse` is constructed and add `fiatCurrency` (from the order's quote). Run `pnpm --filter @handshake-agent/api typecheck` → it will flag the missing property; fill it with the order's `fiatCurrency`.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/dto/buy-order.dto.ts packages/contracts/src/dto/buy-order.dto.spec.ts api/src
git commit -m "feat(contracts): carry fiatCurrency on CreateBuyOrderResponse"
```

---

## Phase 1 — Money-path threading (no behavior change)

### Task 2: Thread `fiatCurrency` through `buildBuyLedgerEntries`

**Files:**

- Modify: `api/src/modules/transactions/domain/ledger.ts` (`BuildBuyLedgerInput` ~64-85, destructure ~289-297, `ngnSpecs` ~318-345)
- Test: `api/src/modules/transactions/domain/ledger.spec.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `BuildBuyLedgerInput` gains `fiatCurrency: string`. Fiat legs use `currency: fiatCurrency` and `accountId: \`${fc}\_processor\``etc. where`fc = fiatCurrency.toLowerCase()`.

- [ ] **Step 1: Write the failing test** (pure domain — takes `string`, so a second currency is testable without touching the enum):

```ts
import { buildBuyLedgerEntries } from "./ledger";

const baseInput = {
  userId: "u1",
  walletId: "w1",
  fiatAmount: "5000",
  cryptoAmount: "3.06",
  processingFee: "50",
  asset: "USDT",
  postedAt: new Date("2026-06-25T00:00:00Z"),
  accountStates: {},
} as const;

it("labels NGN fiat legs with the threaded fiatCurrency (unchanged for NGN)", () => {
  const entries = buildBuyLedgerEntries({ ...baseInput, fiatCurrency: "NGN" });
  const fiatLegs = entries.filter((e) => e.currency === "NGN");
  expect(fiatLegs.length).toBeGreaterThan(0);
  expect(fiatLegs.map((e) => e.accountId)).toEqual(
    expect.arrayContaining(["ngn_processor", "ngn_treasury"]),
  );
});

it("threads a non-NGN fiatCurrency into leg currency and account ids (no NGN literal)", () => {
  const entries = buildBuyLedgerEntries({ ...baseInput, fiatCurrency: "USD" });
  const fiatLegs = entries.filter((e) => e.currency === "USD");
  expect(fiatLegs.length).toBeGreaterThan(0);
  expect(entries.some((e) => e.currency === "NGN")).toBe(false);
  expect(fiatLegs.map((e) => e.accountId)).toEqual(
    expect.arrayContaining(["usd_processor", "usd_treasury"]),
  );
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @handshake-agent/api test ledger` → FAIL (`fiatCurrency` not on input type / `'USD'` legs absent).

- [ ] **Step 3: Implement.** Add the field + fix JSDoc:

```ts
export interface BuildBuyLedgerInput {
  userId: string;
  /** accountId for the user_wallet crypto account. */
  walletId: string;
  /** Gross fiat the user pays in `fiatCurrency`, as a decimal string (NGN example: "5000"). */
  fiatAmount: string;
  /** Crypto amount delivered to the user, as a decimal string (e.g. "3.06"). */
  cryptoAmount: string;
  /** Fiat processing fee (part of fiatAmount) in `fiatCurrency`, as a decimal string. */
  processingFee: string;
  /**
   * The crypto asset symbol (e.g. 'USDT', 'USDC'). Used as the `currency`
   * label on all crypto legs so reads and writes key by (walletId, asset).
   */
  asset: string;
  /**
   * The fiat currency code (e.g. 'NGN'). Used as the `currency` label on all
   * fiat legs and to derive the fiat bookkeeping account ids, so adding a
   * currency is config — not a code change.
   */
  fiatCurrency: string;
  postedAt: Date;
  accountStates: Record<AccountKey, AccountState>;
}
```

Destructure it and derive the account-id prefix:

```ts
const {
  walletId,
  fiatAmount,
  processingFee,
  cryptoAmount,
  asset,
  fiatCurrency,
  postedAt,
  accountStates,
} = input;
const fc = fiatCurrency.toLowerCase();
```

Replace the `ngnSpecs` literals (`'NGN'` → `fiatCurrency`, `'ngn_processor'` → `` `${fc}_processor` ``, `'ngn_treasury'` → `` `${fc}_treasury` ``, `'ngn_fees'` → `` `${fc}_fees` ``). Keep the `Buy: NGN …` description text generic — use `` `Buy: ${fiatCurrency} ${fiatAmount} collected …` ``.

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @handshake-agent/api test ledger` → PASS. (For NGN, `fc='ngn'` → ids unchanged.)

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/transactions/domain/ledger.ts api/src/modules/transactions/domain/ledger.spec.ts
git commit -m "refactor(api): thread fiatCurrency through buildBuyLedgerEntries"
```

### Task 3: Thread `fiatCurrency` through `buildSellFinalizeEntries`

**Files:**

- Modify: `api/src/modules/transactions/domain/ledger.ts` (`BuildSellFinalizeInput` ~515-529, NGN legs ~580-594)
- Test: `api/src/modules/transactions/domain/ledger.spec.ts`

**Interfaces:**

- Produces: `BuildSellFinalizeInput` gains `fiatCurrency: string`; NGN payout legs use it + `${fc}_treasury`/`${fc}_payout`.

- [ ] **Step 1: Write the failing test** (mirror Task 2 for the sell-finalize payout legs):

```ts
import { buildSellFinalizeEntries } from "./ledger";

it("threads fiatCurrency through sell-finalize payout legs", () => {
  const entries = buildSellFinalizeEntries({
    walletId: "w1",
    cryptoAmount: "3.06",
    netFiatAmount: "4800",
    asset: "USDT",
    fiatCurrency: "USD",
    postedAt: new Date("2026-06-25T00:00:00Z"),
    accountStates: {},
  });
  const fiatLegs = entries.filter((e) => e.currency === "USD");
  expect(fiatLegs.map((e) => e.accountId)).toEqual(
    expect.arrayContaining(["usd_treasury", "usd_payout"]),
  );
  expect(entries.some((e) => e.currency === "NGN")).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`fiatCurrency` not on input).

- [ ] **Step 3: Implement.** Add `fiatCurrency: string` to `BuildSellFinalizeInput`, fix the line-520 JSDoc to "Net fiat the user receives in `fiatCurrency` after spread + fee.", destructure `fiatCurrency` (compute `const fc = fiatCurrency.toLowerCase()`), and in the NGN payout legs replace `currency: 'NGN'` → `currency: fiatCurrency`, `accountId: 'ngn_treasury'` → `` `${fc}_treasury` ``, `accountId: 'ngn_payout'` → `` `${fc}_payout` ``, and the `Sell finalize: NGN …` descriptions → `` `Sell finalize: ${fiatCurrency} …` ``.

- [ ] **Step 4: Run to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/transactions/domain/ledger.ts api/src/modules/transactions/domain/ledger.spec.ts
git commit -m "refactor(api): thread fiatCurrency through buildSellFinalizeEntries"
```

### Task 4: Add `fiatCurrency` to settlement port inputs + fix the flagged JSDoc

**Files:**

- Modify: `api/src/modules/transactions/application/ports/settlement.repository.port.ts` (`SettleBuyAtomicInput` ~28-50, `SettleSellFinalizeInput` ~128-148)
- Modify: `api/src/modules/transactions/infrastructure/settlement.prisma.repository.ts` (pass `fiatCurrency` to `buildBuyLedgerEntries`/`buildSellFinalizeEntries`)
- Test: `api/src/modules/transactions/infrastructure/settlement.prisma.repository.spec.ts` (Testcontainers) — or the existing settlement integration test

**Interfaces:**

- Consumes: `buildBuyLedgerEntries`/`buildSellFinalizeEntries` now require `fiatCurrency` (Tasks 2-3).
- Produces: `SettleBuyAtomicInput.fiatCurrency: string`, `SettleSellFinalizeInput.fiatCurrency: string`.

- [ ] **Step 1: Write the failing test** — assert the persisted ledger rows for a settled buy carry the input currency:

```ts
it("persists fiat ledger legs under the input fiatCurrency", async () => {
  const out = await repo.settleBuyAtomic({
    /* …existing fixture fields… */
    fiatCurrency: "NGN",
  });
  const legs = await prisma.ledgerEntry.findMany({
    where: { transactionId: out.transactionId },
  });
  expect(
    legs.some((l) => l.currency === "NGN" && l.accountId === "ngn_processor"),
  ).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`fiatCurrency` not accepted on `SettleBuyAtomicInput`).

- [ ] **Step 3: Implement.** In the port, fix the user-flagged JSDoc and add the field to both inputs:

```ts
export interface SettleBuyAtomicInput {
  transactionId: string;
  userId: string;
  walletId: string;
  /** Gross fiat the user paid in `fiatCurrency` (decimal string, NGN example: "10000"). */
  fiatAmount: string;
  cryptoAmount: string;
  /** Processing fee portion of fiatAmount in `fiatCurrency` (decimal string, NGN example: "100"). */
  processingFee: string;
  asset: string;
  /** The fiat currency code (e.g. 'NGN'); threaded to the ledger builder for the fiat legs. */
  fiatCurrency: string;
  providerRef: string;
  now: Date;
  year: string;
}
```

Add the same `fiatCurrency: string` (with the "Net fiat the user receives in `fiatCurrency`" JSDoc) to `SettleSellFinalizeInput`. In `settlement.prisma.repository.ts`, pass `fiatCurrency: input.fiatCurrency` into the `buildBuyLedgerEntries({...})` and `buildSellFinalizeEntries({...})` calls.

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @handshake-agent/api test settlement` → PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/transactions/application/ports/settlement.repository.port.ts api/src/modules/transactions/infrastructure/settlement.prisma.repository.ts api/src/modules/transactions/infrastructure/settlement.prisma.repository.spec.ts
git commit -m "refactor(api): carry fiatCurrency on settlement inputs; fix NGN-only JSDoc"
```

### Task 5: Replace buy-side `'NGN'` literals in `execution.service.ts`

**Files:**

- Modify: `api/src/modules/transactions/application/execution.service.ts` (lines ~115-123, 338-348, 458-470, 502-510, 565-575)
- Test: `api/src/modules/transactions/application/execution.service.spec.ts`

**Interfaces:**

- Consumes: `storedQuote.fiatCurrency` (loaded at ~334 via `quoteRepo.findById`, type `QuoteRecord`), `meta.fiatCurrency` (already persisted into metadata at ~418-428), `SettleBuyAtomicInput.fiatCurrency` (Task 4).
- Produces: `ExecuteBuyResult.payment.currency: string` (was `'NGN'`).

- [ ] **Step 1: Write the failing test** — assert the buy result + collection currency come from the quote, not a literal:

```ts
it("uses the quote fiatCurrency for the collection and result, not a literal", async () => {
  // arrange a stored quote with fiatCurrency 'NGN'
  const res = await service.executeBuy({
    /* …existing args… */
  });
  expect(res.payment.currency).toBe("NGN");
  expect(paymentProvider.createCollection).toHaveBeenCalledWith(
    expect.objectContaining({ currency: "NGN" }),
  );
});
```

- [ ] **Step 2: Run to verify it fails initially?** This passes today (NGN literal). To make it a real regression guard, also assert `settleBuyAtomic`/builder receive `fiatCurrency`. Add:

```ts
expect(settlementRepo.settleBuyAtomic).toHaveBeenCalledWith(
  expect.objectContaining({ fiatCurrency: "NGN" }),
);
```

Run → FAIL (`settleBuyAtomic` called without `fiatCurrency`).

- [ ] **Step 3: Implement.** Make the edits (import `FiatCurrency` from `@handshake-agent/contracts` if not already):
  - `ExecuteBuyResult.payment.currency: 'NGN'` → `currency: string`.
  - Line ~343 re-quote: `fiatCurrency: storedQuote.fiatCurrency as 'NGN'` → `fiatCurrency: storedQuote.fiatCurrency as FiatCurrency` (mirrors the existing `asset as 'USDT' | 'BTC'` cast one line up).
  - Line ~464 `createCollection({ currency: 'NGN' })` → `currency: storedQuote.fiatCurrency`.
  - Line ~508 return `currency: 'NGN'` → `currency: storedQuote.fiatCurrency`.
  - Line ~571 verify: `verifyResult.currency !== 'NGN'` → `verifyResult.currency !== meta.fiatCurrency` (read `meta.fiatCurrency` alongside `meta.fiatAmount` at ~566).
  - In the `settleBuyAtomic({...})` call, add `fiatCurrency: storedQuote.fiatCurrency` (or `meta.fiatCurrency` on the settle path).

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @handshake-agent/api test execution.service` → PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/transactions/application/execution.service.ts api/src/modules/transactions/application/execution.service.spec.ts
git commit -m "refactor(api): thread quote fiatCurrency through the buy execution path"
```

### Task 6: Replace sell-side `'NGN'` literals + remove `'TRON'` fallbacks

**Files:**

- Modify: `api/src/modules/transactions/application/execution.service.ts` (lines ~678-690, 853-863, 1102-1115, 1440-1450, 1668-1680, 1770-1780)
- Test: `api/src/modules/transactions/application/execution.service.spec.ts`

**Interfaces:**

- Consumes: `storedQuote.fiatCurrency`, `meta.fiatCurrency`, `SettleSellFinalizeInput.fiatCurrency` (Task 4), `AssetRegistry.formatFiat(code, amount)`.

- [ ] **Step 1: Write the failing tests:**

```ts
it("uses the quote fiatCurrency for the payout, not a literal", async () => {
  const res = await service.executeSell({
    /* … */
  });
  expect(paymentProvider.createPayout).toHaveBeenCalledWith(
    expect.objectContaining({ currency: "NGN" }),
  );
  expect(settlementRepo.settleSellFinalizeAtomic).toHaveBeenCalledWith(
    expect.objectContaining({ fiatCurrency: "NGN" }),
  );
});

it("fails closed when a send proposal has no network (no TRON default)", async () => {
  await expect(
    service.executeSend({
      /* proposal with parameters.network = undefined */
    }),
  ).rejects.toThrow(/network/i);
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL on the `fiatCurrency` settle expectation and on the network expectation (currently defaults to `'TRON'`).

- [ ] **Step 3: Implement:**
  - Line ~684 re-quote cast: `as 'NGN'` → `as FiatCurrency`.
  - Line ~859 `createPayout({ currency: 'NGN' })` → `currency: storedQuote.fiatCurrency`.
  - In the `settleSellFinalizeAtomic({...})` call, add `fiatCurrency: storedQuote.fiatCurrency` (or `meta.fiatCurrency`).
  - Line ~1668 `formatFiat('NGN', params.netFiatAmount)` → `formatFiat(params.fiatCurrency ?? meta.fiatCurrency, params.netFiatAmount)` — thread the currency into `notifySellComplete` (add `fiatCurrency` to its params, sourced from the txn metadata at the call site).
  - Line ~1770 `buildResultFromTransaction` return `currency: 'NGN'` → `currency: meta.fiatCurrency` (read from `meta`).
  - Line ~1108 `const network = params.network ?? 'TRON'` → `const network = params.network; if (!network) throw new ProposalNotExecutableError('proposal parameters missing network');`
  - Line ~1445 `const network = meta.network ?? 'TRON'` → `const network = meta.network; if (!network) { return { status: 'pending' }; }` (consistent with the adjacent `if (!walletId) return pending` fail-safe).

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @handshake-agent/api test execution.service` → PASS. Then full suite: `pnpm --filter @handshake-agent/api test` → all green (no behavior change for NGN/TRON).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/transactions/application/execution.service.ts api/src/modules/transactions/application/execution.service.spec.ts
git commit -m "refactor(api): thread fiatCurrency through sell path; fail-closed on missing network"
```

---

## Phase 2 — Per-fiat config & resolvers

### Task 7: Make pricing `baseRate` per-fiat (`baseRates[fiat]`)

**Files:**

- Modify: `api/src/core/config/configuration.ts` (`AssetPricing` ~11-18, pricing defaults ~391-410)
- Modify: `api/src/modules/quotes/infrastructure/config-rate.provider.ts` (~20-43)
- Modify: `api/src/modules/transactions/application/proposal.service.ts` (~469-475)
- Test: `api/src/modules/quotes/infrastructure/config-rate.provider.spec.ts`

**Interfaces:**

- Produces: `AssetPricing.baseRates: Record<string, number>` (replaces `baseRate: number`). `getRate(asset, fiat)` resolves `assetPricing.baseRates[fiat]`, fail-closed.

- [ ] **Step 1: Write the failing tests:**

```ts
it("resolves the per-fiat base rate", async () => {
  const rate = await provider.getRate("USDT", "NGN");
  expect(rate.baseRate).toBe(1600);
});

it("fails closed when the asset has no rate for the requested fiat", async () => {
  await expect(provider.getRate("USDT", "USD")).rejects.toThrow(/USD/);
});
```

(Use a test config whose `pricing.assets.USDT.baseRates` has only `NGN`.)

- [ ] **Step 2: Run to verify it fails** — FAIL (`baseRate` is a scalar; `getRate` ignores the fiat arg).

- [ ] **Step 3: Implement.** Interface + defaults:

```ts
export interface AssetPricing {
  /** Base mid-market rate per 1 unit of the crypto asset, keyed by fiat code. */
  baseRates: Record<string, number>;
  buySpreadBps: number;
  sellSpreadBps: number;
  cryptoDecimals: number;
}
```

```ts
  pricing: {
    processingFeeBps: 100,
    expiresInSec: 30,
    assets: {
      USDT: { baseRates: { NGN: 1600 }, buySpreadBps: 150, sellSpreadBps: 150, cryptoDecimals: 6 },
      BTC: { baseRates: { NGN: 100_000_000 }, buySpreadBps: 150, sellSpreadBps: 150, cryptoDecimals: 8 },
    },
  },
```

`config-rate.provider.ts`:

```ts
const assetPricing = pricing?.assets[asset];
const baseRate = assetPricing?.baseRates?.[fiatCurrency];
if (!pricing || !assetPricing || baseRate === undefined) {
  return Promise.reject(
    new Error(`No pricing configured for asset ${asset} in ${fiatCurrency}`),
  );
}
return Promise.resolve({
  baseRate,
  buySpreadBps: assetPricing.buySpreadBps,
  // …rest unchanged…
});
```

`proposal.service.ts` ~469-475 — resolve via the base fiat (see Task 9 for `defaultFiat()`):

```ts
const baseFiat = this.assetRegistry.defaultFiat();
const pricingConfig = this.configService.get<PricingConfig>("pricing");
const baseRate = pricingConfig?.assets?.[intent.asset]?.baseRates?.[baseFiat];
if (baseRate === undefined) {
  throw new Error(
    `ProposalService: missing pricing.assets.${intent.asset}.baseRates.${baseFiat} in config — cannot compute fiat value for KYC gate.`,
  );
}
```

(If `proposal.service` does not yet inject `AssetRegistry`, add it to the constructor and the module providers. Do Task 9's `defaultFiat()` first if executing inline.)

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @handshake-agent/api test config-rate.provider proposal.service` → PASS.

- [ ] **Step 5: Grep for other `.baseRate` readers** — `grep -rn "\.baseRate\b" api/src` and update any remaining reader to `baseRates[fiat]`. Run `pnpm --filter @handshake-agent/api typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add api/src/core/config/configuration.ts api/src/modules/quotes/infrastructure/config-rate.provider.ts api/src/modules/quotes/infrastructure/config-rate.provider.spec.ts api/src/modules/transactions/application/proposal.service.ts
git commit -m "feat(config): per-fiat pricing baseRates with fail-closed resolution"
```

### Task 8: Make KYC tier limits per-fiat

**Files:**

- Modify: `api/src/core/config/configuration.ts` (`TierLimits`/`LimitsConfig` ~27-47, limits defaults ~416-435)
- Modify: `api/src/modules/identity/application/kyc-gate.service.ts` (`getTierLimits` ~33-40, `AssertCanTransactInput` ~60-69, body ~148-194)
- Modify: callers of `assertCanTransact` (grep)
- Test: `api/src/modules/identity/application/kyc-gate.service.spec.ts`

**Interfaces:**

- Produces: `LimitsConfig = Record<string, FiatLimits>` where `FiatLimits = { tier_1: TierLimits; tier_2: TierLimits; tier_3: TierLimits }`. `getTierLimits(tier, fiatCurrency, limits)`. `AssertCanTransactInput.fiatCurrency: string`.

- [ ] **Step 1: Write the failing tests:**

```ts
it("resolves the per-fiat tier limit for the transaction currency", async () => {
  await expect(
    gate.assertCanTransact({
      userId,
      fiatAmount: "60000",
      asset: "USDT",
      fiatCurrency: "NGN",
    }),
  ).rejects.toBeInstanceOf(TierLimitExceededError); // tier_1 perTxFiatMax = 50_000
});

it("fails closed for a currency with no configured limits", async () => {
  await expect(
    gate.assertCanTransact({
      userId,
      fiatAmount: "1",
      asset: "USDT",
      fiatCurrency: "USD",
    }),
  ).rejects.toThrow(/USD/);
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`fiatCurrency` not on input; `getTierLimits` ignores currency).

- [ ] **Step 3: Implement.** Config:

```ts
export interface TierLimits {
  perTxFiatMax: number;
  dailyFiatMax: number;
  dailyTxCountMax: number;
}
export interface FiatLimits {
  tier_1: TierLimits;
  tier_2: TierLimits;
  tier_3: TierLimits;
}
/** Per-fiat, per-KYC-tier limits, keyed by fiat code. Admin-tunable. */
export type LimitsConfig = Record<string, FiatLimits>;
```

```ts
  limits: {
    NGN: {
      tier_1: { perTxFiatMax: 50_000, dailyFiatMax: 200_000, dailyTxCountMax: 10 },
      tier_2: { perTxFiatMax: 500_000, dailyFiatMax: 2_000_000, dailyTxCountMax: 30 },
      tier_3: { perTxFiatMax: 5_000_000, dailyFiatMax: 20_000_000, dailyTxCountMax: 100 },
    },
  },
```

`kyc-gate.service.ts`:

```ts
function getTierLimits(
  tier: string,
  fiatCurrency: string,
  limits: LimitsConfig,
): TierLimits {
  const fiatLimits = limits[fiatCurrency];
  if (!fiatLimits) {
    throw new Error(`KycGate: no limits configured for fiat ${fiatCurrency}`);
  }
  const verifiedTiers: VerifiedTier[] = ["tier_1", "tier_2", "tier_3"];
  if ((verifiedTiers as string[]).includes(tier)) {
    return fiatLimits[tier as VerifiedTier];
  }
  throw new Error(`Unexpected kycTier value after verification gate: ${tier}`);
}
```

Add `fiatCurrency: string;` to `AssertCanTransactInput` (fix the "Exact NGN amount" JSDoc → "Exact fiat amount in `fiatCurrency`"), destructure it, and call `getTierLimits(user.kycTier, fiatCurrency, limits)`.

- [ ] **Step 4: Update callers.** `grep -rn "assertCanTransact(" api/src`. For buy/sell proposal paths pass the quote/order `fiatCurrency`; for the send path pass `this.assetRegistry.defaultFiat()` (Task 9). Run `pnpm --filter @handshake-agent/api typecheck` → clean.

- [ ] **Step 5: Run to verify it passes** — `pnpm --filter @handshake-agent/api test kyc-gate` → PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/core/config/configuration.ts api/src/modules/identity/application/kyc-gate.service.ts api/src/modules/identity/application/kyc-gate.service.spec.ts api/src/modules/transactions/application/proposal.service.ts
git commit -m "feat(config): per-fiat KYC tier limits threaded through the gate"
```

### Task 9: Per-fiat Travel-Rule threshold + `AssetRegistry.defaultFiat()`

**Files:**

- Modify: `api/src/core/catalog/asset-registry.ts` (add `defaultFiat()`)
- Modify: `api/src/core/config/configuration.ts` (`ComplianceConfig` ~138-165, compliance defaults ~380-390)
- Modify: `api/src/modules/transactions/application/proposal.service.ts` (~509-511, 568-577)
- Test: `api/src/core/catalog/asset-registry.spec.ts`, `api/src/modules/transactions/application/proposal.service.spec.ts`

**Interfaces:**

- Produces: `AssetRegistry.defaultFiat(): string` (first enabled fiat). `ComplianceConfig.travelRuleThresholds: Record<string, number>` (replaces `travelRuleThresholdNgn`).

- [ ] **Step 1: Write the failing tests:**

```ts
// asset-registry.spec.ts
it("returns the first enabled fiat as the base fiat", () => {
  expect(registry.defaultFiat()).toBe("NGN");
});

// proposal.service.spec.ts
it("flags travel rule using the base-fiat threshold", async () => {
  // cryptoAmount * baseRates.NGN >= travelRuleThresholds.NGN (1_000_000)
  const proposal = await service.createSendProposal({
    /* large amount */
  });
  expect(proposal.requiresTravelRule).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`defaultFiat` undefined; `travelRuleThresholds` undefined).

- [ ] **Step 3: Implement.** `asset-registry.ts` (mirror `defaultCryptoAsset()`):

```ts
  /**
   * Returns the code of the first enabled fiat in the catalog — the base/settlement
   * fiat used to value crypto-only flows (send/swap) for the KYC + Travel-Rule gates.
   * @throws {UnsupportedFiatError} when no enabled fiat is registered.
   */
  defaultFiat(): string {
    const code = Object.values(this.catalog.fiats).find((f) => f.enabled)?.code;
    if (!code) {
      throw new UnsupportedFiatError('default', 'no enabled fiat registered in the catalog');
    }
    return code;
  }
```

`configuration.ts` — replace the scalar (keep the FATF/CBN JSDoc, drop the `…Ngn` name):

```ts
export interface ComplianceConfig {
  /** Travel-Rule data-capture threshold per fiat code, in major units (NGN example: 1_000_000 = ₦1,000,000). */
  travelRuleThresholds: Record<string, number>;
  sanctionsDenylist: string[];
}
```

```ts
  compliance: {
    travelRuleThresholds: { NGN: 1_000_000 },
    sanctionsDenylist: [] as string[],
  },
```

`proposal.service.ts` ~511 + ~568-577:

```ts
const baseFiat = this.assetRegistry.defaultFiat();
const fiatValue = Number(intent.cryptoAmount) * baseRate; // baseRate from baseRates[baseFiat] (Task 7)
// …
const complianceConfig = this.configService.get<ComplianceConfig>("compliance");
const travelRuleThreshold = complianceConfig?.travelRuleThresholds?.[baseFiat];
if (travelRuleThreshold === undefined) {
  throw new Error(
    `ProposalService: missing compliance.travelRuleThresholds.${baseFiat} in config — cannot evaluate Travel Rule requirement.`,
  );
}
const requiresTravelRule = fiatValue >= travelRuleThreshold;
```

- [ ] **Step 4: Update other `travelRuleThresholdNgn` readers** — `grep -rn "travelRuleThresholdNgn" api/src` and update tests/usages to `travelRuleThresholds.NGN`.

- [ ] **Step 5: Run to verify it passes** — `pnpm --filter @handshake-agent/api test asset-registry proposal.service` → PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/core/catalog/asset-registry.ts api/src/core/config/configuration.ts api/src/modules/transactions/application/proposal.service.ts api/src/core/catalog/asset-registry.spec.ts api/src/modules/transactions/application/proposal.service.spec.ts
git commit -m "feat(config): per-fiat Travel-Rule thresholds + AssetRegistry.defaultFiat"
```

---

## Phase 3 — Velocity per-currency

### Task 10: Prisma migration — add `fiatCurrency` to `VelocityCounter`

**Files:**

- Modify: `api/prisma/schema/01-audit.prisma` (`VelocityCounter` ~299-316)
- Create: `api/prisma/migrations/<timestamp>_velocity_per_currency/migration.sql`

**Interfaces:**

- Produces: `velocity_counters.fiat_currency` column (`FiatCurrency`, default `NGN`); unique becomes `(userId, counterType, fiatCurrency)`.

- [ ] **Step 1: Edit the schema:**

```prisma
model VelocityCounter {
  id           String              @id @default(uuid(7)) @db.Uuid
  userId       String              @db.Uuid
  counterType  VelocityCounterType
  fiatCurrency FiatCurrency        @default(NGN)
  currentValue Decimal             @db.Decimal(38, 18)
  windowStart  DateTime            @db.Timestamptz
  windowEnd    DateTime            @db.Timestamptz
  createdAt    DateTime            @default(now()) @db.Timestamptz
  updatedAt    DateTime            @updatedAt @db.Timestamptz

  user User @relation(fields: [userId], references: [id])

  @@unique([userId, counterType, fiatCurrency])
  @@index([userId, windowEnd])
  @@index([updatedAt])
  @@map("velocity_counters")
}
```

- [ ] **Step 2: Generate the migration** — `pnpm --filter @handshake-agent/api exec prisma migrate dev --name velocity_per_currency`. Confirm the generated SQL adds the column with default `'NGN'` (backfills existing rows) before swapping the unique index. If the generated drop/add of the unique constraint is present, keep it; existing rows backfill to `NGN` via the column default.

- [ ] **Step 3: Regenerate the client** — `pnpm --filter @handshake-agent/api exec prisma generate`.

- [ ] **Step 4: Verify** — `pnpm --filter @handshake-agent/api typecheck` (the generated `VelocityCounterWhereUniqueInput` now expects the compound key; this will surface the repo call sites Task 11 fixes).

- [ ] **Step 5: Commit**

```bash
git add api/prisma/schema/01-audit.prisma api/prisma/migrations
git commit -m "feat(api): velocity counters gain a per-currency dimension (migration)"
```

### Task 11: Thread `fiatCurrency` through velocity read + write paths

**Files:**

- Modify: `api/src/modules/transactions/application/ports/transaction.repository.port.ts` (`VelocityIncrementData` ~75-84)
- Modify: `api/src/modules/transactions/infrastructure/transaction.prisma.repository.ts` (`upsertVelocityCounter` ~126-160, `writeVelocityIncrements` ~172-183)
- Modify: `api/src/modules/transactions/infrastructure/settlement.prisma.repository.ts` (`upsertVelocityCounterInSettle` ~618-649)
- Modify: `api/src/modules/identity/application/ports/velocity.repository.port.ts` (`getDailyUsage` ~23-34)
- Modify: `api/src/modules/identity/infrastructure/velocity.prisma.repository.ts` (`getDailyUsage` ~40-55)
- Modify: `api/src/modules/identity/application/kyc-gate.service.ts` (the `getDailyUsage` call ~170-171)
- Test: `api/src/modules/identity/infrastructure/velocity.prisma.repository.spec.ts` (Testcontainers)

**Interfaces:**

- Consumes: the compound unique key from Task 10. `getTierLimits`/`AssertCanTransactInput.fiatCurrency` from Task 8.
- Produces: `VelocityIncrementData.fiatCurrency: string`; `getDailyUsage(userId, asOf, fiatCurrency)`.

- [ ] **Step 1: Write the failing integration test:**

```ts
it("isolates velocity usage per (userId, counterType, fiatCurrency)", async () => {
  await repo.write({
    userId,
    counterType: "amount_24h",
    fiatCurrency: "NGN",
    delta: "100",
    now,
  });
  const ngn = await repo.getDailyUsage(userId, now, "NGN");
  const usd = await repo.getDailyUsage(userId, now, "USD");
  expect(ngn.fiatTotal).toBe("100");
  expect(usd.fiatTotal).toBe("0"); // no cross-currency aggregation
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (`getDailyUsage` takes no currency; upsert where-clause lacks it).

- [ ] **Step 3: Implement.** Port:

```ts
export interface VelocityIncrementData {
  userId: string;
  /** Fiat currency code for the counter's window (e.g. 'NGN'). */
  fiatCurrency: string;
  fiatAmountStr: string;
  now: Date;
}
```

Both `upsertVelocityCounter` copies — thread `fiatCurrency` into the compound key and create:

```ts
const existing = await tx.velocityCounter.findUnique({
  where: {
    userId_counterType_fiatCurrency: { userId, counterType, fiatCurrency },
  },
  select: { windowEnd: true, currentValue: true },
});
// …windowExpired branch:
await tx.velocityCounter.upsert({
  where: {
    userId_counterType_fiatCurrency: { userId, counterType, fiatCurrency },
  },
  create: {
    userId,
    counterType,
    fiatCurrency,
    currentValue: delta,
    windowStart: now,
    windowEnd,
  },
  update: { currentValue: delta, windowStart: now, windowEnd },
});
// …active branch uses the same compound where.
```

`writeVelocityIncrements` (~172-183): destructure `fiatCurrency` from `increment` and pass it to both `upsertVelocityCounter` calls. `velocity.repository.port.ts`:

```ts
  getDailyUsage(userId: string, asOf: Date, fiatCurrency: string): Promise<DailyUsage>;
```

`velocity.prisma.repository.ts` (~40-55): add `fiatCurrency` to the `findMany` `where`. `kyc-gate.service.ts` (~170-171): `await this.velocityRepo.getDailyUsage(userId, asOf, fiatCurrency)`.

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @handshake-agent/api test velocity` → PASS, then `pnpm --filter @handshake-agent/api test` → all green.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/transactions api/src/modules/identity
git commit -m "feat(api): thread fiatCurrency through velocity read and write paths"
```

---

## Phase 4 — Strings & agent prompt

### Task 12: Make KYC-gate limit errors currency-aware

**Files:**

- Read first: the error classes `TierLimitExceededError` / `VelocityExceededError` (grep `domain` of identity/transactions)
- Modify: those error classes + the throw sites in `kyc-gate.service.ts` (~162-194)
- Test: the error-class spec + `kyc-gate.service.spec.ts`

**Interfaces:**

- Produces: the error message/ payload includes the `fiatCurrency` code (or the catalog symbol) instead of an implicit NGN.

- [ ] **Step 1: Read the error classes** — `grep -rn "class TierLimitExceededError\|class VelocityExceededError" api/src` and read them. Confirm whether the message hardcodes "NGN" or a `₦` symbol.

- [ ] **Step 2: Write the failing test** — assert the thrown error mentions the transaction currency:

```ts
it("names the transaction currency in the limit error", async () => {
  const err = await gate
    .assertCanTransact({
      userId,
      fiatAmount: "60000",
      asset: "USDT",
      fiatCurrency: "NGN",
    })
    .catch((e) => e);
  expect(String(err.message)).toContain("NGN");
});
```

- [ ] **Step 3: Run to verify it fails** — FAIL if the message lacks the code (or passes already if it never had a symbol — in which case extend the error to accept and surface `fiatCurrency`).

- [ ] **Step 4: Implement** — add a `fiatCurrency` (or `currencyCode`) constructor arg to each error class, include it in the message, and pass `fiatCurrency` at the four throw sites in `kyc-gate.service.ts`.

- [ ] **Step 5: Run to verify it passes** — `pnpm --filter @handshake-agent/api test kyc-gate` → PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/identity api/src/modules/transactions
git commit -m "refactor(api): make KYC limit errors name the transaction currency"
```

### Task 13: Render the agent prompt basket from the catalog

**Files:**

- Modify: `api/src/modules/agent/infrastructure/anthropic-llm.provider.ts` (`SYSTEM_PROMPT` ~21-36)
- Test: `api/src/modules/agent/infrastructure/anthropic-llm.provider.spec.ts`

**Interfaces:**

- Consumes: `AssetRegistry` (enabled assets/fiats). Inject it into the provider (infrastructure layer — allowed to depend on the registry; the agent _core_ stays clean per §3.2/§6).

- [ ] **Step 1: Write the failing test:**

```ts
it("lists the catalog-enabled assets and default fiat in the system prompt", () => {
  const prompt = provider.buildSystemPrompt(); // or inspect the prompt sent to ChatAnthropic
  expect(prompt).toContain("USDT");
  expect(prompt).toContain("NGN");
  expect(prompt).not.toContain('Only "USDT" and "BTC"'); // no hardcoded basket
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (prompt is a hardcoded `const` string with `Only "USDT" and "BTC"`).

- [ ] **Step 3: Implement** — inject `AssetRegistry`, build the supported-asset list (`Object.values(catalog.assets).filter(enabled)`) and the default fiat (`registry.defaultFiat()`) into the prompt at construction; replace rules 2 and 3 with the rendered values. Keep all other rules verbatim.

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @handshake-agent/api test anthropic-llm.provider` → PASS. Then `pnpm depcruise` → the agent _core_ still imports no Nest/registry (only the infrastructure adapter does).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/agent/infrastructure/anthropic-llm.provider.ts api/src/modules/agent/infrastructure/anthropic-llm.provider.spec.ts
git commit -m "refactor(agent): render system-prompt asset/fiat basket from the catalog"
```

---

## Phase 5 — `/config` endpoint + frontend discovery

### Task 14: Contracts — `PublicConfigResponseSchema`

**Files:**

- Create: `packages/contracts/src/dto/config.dto.ts`
- Modify: `packages/contracts/src/dto/index.ts`
- Test: `packages/contracts/src/dto/config.dto.spec.ts`

**Interfaces:**

- Produces: `PublicConfigResponseSchema` / `PublicConfigResponse` — enabled fiats/networks/assets + per-fiat tier limits. Non-secret only.

- [ ] **Step 1: Write the failing test:**

```ts
import { PublicConfigResponseSchema } from "./config.dto";

it("parses a non-secret public config payload", () => {
  const parsed = PublicConfigResponseSchema.parse({
    fiats: [{ code: "NGN", displayName: "Naira", symbol: "₦", decimals: 2 }],
    assets: [
      { symbol: "USDT", displayName: "USDT", decimals: 6, networks: ["TRON"] },
    ],
    networks: [{ id: "TRON", displayName: "TRON (TRC-20)" }],
    capabilities: { "crypto.buy": true, "crypto.swap": false },
  });
  expect(parsed.fiats[0].symbol).toBe("₦");
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (module not found).

- [ ] **Step 3: Implement** `config.dto.ts`:

```ts
import { z } from "zod";

export const PublicFiatSchema = z.object({
  code: z.string(),
  displayName: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
});
export const PublicAssetSchema = z.object({
  symbol: z.string(),
  displayName: z.string(),
  decimals: z.number().int().nonnegative(),
  networks: z.array(z.string()),
});
export const PublicNetworkSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

export const PublicConfigResponseSchema = z.object({
  fiats: z.array(PublicFiatSchema),
  assets: z.array(PublicAssetSchema),
  networks: z.array(PublicNetworkSchema),
  capabilities: z.record(z.boolean()),
});
export type PublicConfigResponse = z.infer<typeof PublicConfigResponseSchema>;
```

Add `export * from './config.dto'` to `dto/index.ts`.

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @handshake-agent/contracts test config` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/dto/config.dto.ts packages/contracts/src/dto/config.dto.spec.ts packages/contracts/src/dto/index.ts
git commit -m "feat(contracts): PublicConfigResponse schema for the /config endpoint"
```

### Task 15: Backend `/config` endpoint backed by `AssetRegistry`

**Files:**

- Create: `api/src/modules/config/presentation/public-config.controller.ts`
- Create: `api/src/modules/config/config.module.ts`
- Modify: `api/src/app.module.ts` (register the module; ensure `AssetRegistry` is provided/exported where the module can inject it)
- Test: `api/test/public-config.e2e-spec.ts`

**Interfaces:**

- Consumes: `AssetRegistry` (enabled fiats/assets/networks + `isCapabilityEnabled`). `PublicConfigResponseSchema` (Task 14) via `createZodDto`.
- Produces: `GET /config` → `PublicConfigResponse` (only `enabled` entries; no secrets — never expose `masterWalletId`, provider ids, or `addressPattern`).

- [ ] **Step 1: Write the failing e2e test:**

```ts
it("GET /config returns only enabled, non-secret catalog entries", async () => {
  const res = await request(app.getHttpServer()).get("/config").expect(200);
  expect(res.body.fiats).toEqual([
    expect.objectContaining({ code: "NGN", symbol: "₦" }),
  ]);
  expect(res.body.assets[0].symbol).toBe("USDT");
  expect(JSON.stringify(res.body)).not.toContain("masterWalletId");
  expect(JSON.stringify(res.body)).not.toContain("assetId");
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (route 404).

- [ ] **Step 3: Implement** the controller — map the catalog's enabled entries into the `PublicConfigResponse` shape (drop `providers`, `masterWalletId`, `amlBlockchain`, `addressPattern`, `networkFeeCrypto`). Register `ConfigModule` in `app.module.ts`. If `AssetRegistry` is not yet exported from a shared module, add a method to it (e.g. `publicConfig()`) or expose the underlying maps via existing getters; prefer adding a single `publicView()` method on `AssetRegistry` that returns the non-secret projection so the controller stays thin.

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @handshake-agent/api test:e2e public-config` → PASS. `pnpm depcruise` → controller (presentation) depends only on `core`/registry, not Prisma.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/config api/src/app.module.ts api/test/public-config.e2e-spec.ts api/src/core/catalog/asset-registry.ts
git commit -m "feat(api): GET /config exposes the non-secret catalog to the frontend"
```

### Task 16: Frontend — consume `/config` and drop the hardcoded basket

**Files:**

- Modify: `web/lib/api/gateway.ts` (add `getConfig`)
- Modify: `web/lib/query/keys.ts` (`qk.config`) + `web/lib/query/hooks.ts` (`useConfig`)
- Modify: `web/lib/constants.ts` (derive the supported basket from config where used for logic)
- Test: `web/lib/query/__tests__/useConfig.test.tsx` (Vitest + RTL)

**Interfaces:**

- Consumes: `PublicConfigResponseSchema` from `@handshake-agent/contracts` (parse the response). The axios instance in `lib/api/client.ts`.
- Produces: `gateway.getConfig(): Promise<PublicConfigResponse>`, `useConfig()` hook keyed `qk.config`.

- [ ] **Step 1: Write the failing test** — mock the gateway and assert `useConfig` returns parsed fiats:

```tsx
it("useConfig returns the enabled fiats from /config", async () => {
  vi.spyOn(gateway, "getConfig").mockResolvedValue({
    fiats: [{ code: "NGN", displayName: "Naira", symbol: "₦", decimals: 2 }],
    assets: [],
    networks: [],
    capabilities: {},
  });
  const { result } = renderHook(() => useConfig(), { wrapper });
  await waitFor(() => expect(result.current.data?.fiats[0].symbol).toBe("₦"));
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @handshake-agent/web test useConfig` → FAIL (`getConfig`/`useConfig` undefined).

- [ ] **Step 3: Implement.** `gateway.ts` real impl:

```ts
  async getConfig() {
    const { data } = await api.get('/config')
    return PublicConfigResponseSchema.parse(data)
  },
```

(Add `getConfig` to the `Gateway` interface and a mock impl returning the NGN/USDT/TRON basket so `NEXT_PUBLIC_USE_MOCK` keeps working.) `keys.ts`: `config: ['config'] as const`. `hooks.ts`:

```ts
export function useConfig() {
  return useQuery({
    queryKey: qk.config,
    queryFn: () => gateway.getConfig(),
    staleTime: 5 * 60_000,
  });
}
```

Where `ASSET_TINTS` keys are used to decide _which_ assets/currencies are supported (logic, not just color), source the list from `useConfig()`; keep `ASSET_TINTS` as a presentational color lookup only.

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @handshake-agent/web test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/api/gateway.ts web/lib/query/keys.ts web/lib/query/hooks.ts web/lib/constants.ts web/lib/query/__tests__/useConfig.test.tsx
git commit -m "feat(web): discover supported currencies/networks/assets via /config"
```

---

## Final verification (run yourself; do not trust per-task green)

- [ ] `pnpm --filter @handshake-agent/contracts test` → green
- [ ] `pnpm --filter @handshake-agent/api test` and `test:e2e` → green; coverage holds on touched domain/application/engine
- [ ] `pnpm --filter @handshake-agent/web test` → green
- [ ] `pnpm typecheck` (all packages) → clean
- [ ] `pnpm lint` → clean
- [ ] `pnpm depcruise` → clean (agent core still DB-free; presentation never imports Prisma)
- [ ] `grep -rn "'NGN'\|\"NGN\"\|travelRuleThresholdNgn\|?? 'TRON'" api/src` → only the narrow enum definition + intent `.default('NGN')` remain; no money-path literals
- [ ] Confirm enums unchanged: `FiatCurrencySchema`/`NetworkSchema`/`SupportedAssetSchema` still narrow; JSON defaults still NGN/TRON/USDT only

## Self-review notes (spec coverage)

- Spec §1 Contracts → Task 1 (+ enums deliberately unchanged; `.default('NGN')` retained per Global Constraints).
- Spec §2 Money path → Tasks 2-6 (ledger, settlement port, execution literals, TRON fallbacks).
- Spec §3 Config → Tasks 7-9 (pricing baseRates, limits, travel-rule).
- Spec §4 Velocity → Tasks 10-11.
- Spec §5 strings/prompt/FE → Tasks 12-13 (strings/prompt) + 14-16 (`/config` + FE).
- Out-of-scope honored: enums stay narrow, no second market enabled, no cross-currency velocity aggregation, 2-dp `FiatAmountSchema` retained.

## Drift found (surface, not silently fixed)

- `ledger.ts:360` hardcodes `accountId: 'usdt_treasury'` for the crypto treasury leg even though `asset` is threaded as the leg currency — a WN-4 leftover (asset axis, out of this scope). Worth a follow-up to derive it as `${asset.toLowerCase()}_treasury`.
- `upsertVelocityCounter` is duplicated verbatim in `transaction.prisma.repository.ts` and `settlement.prisma.repository.ts` — two copies kept in sync by hand (DRY risk). Consider extracting a shared infra helper in a follow-up.
- `web/lib/chat/flow.ts` and `web/lib/api/fixtures.ts` carry hardcoded `₦`/USDT money literals — these are mock chat scaffolding, left as-is; replace when the real chat flow lands.
