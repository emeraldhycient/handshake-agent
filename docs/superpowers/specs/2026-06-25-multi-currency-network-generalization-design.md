# Multi-currency / multi-network generalization — design

**Date:** 2026-06-25
**Branch:** `feat/multi-currency-generalization` (off `main`, after PR #8 `feat/wallet-per-network` merged)
**Status:** Approved design — implementation plan to follow.

## Problem

The codebase still hard-codes fiat currency to NGN (and, in a couple of spots,
network to TRON) **by value** rather than **by architecture**. Examples the user
flagged:

```ts
/** Gross NGN the user paid (decimal string, e.g. "10000"). */
/** NGN processing fee portion of fiatAmount (decimal string, e.g. "100"). */
```

…plus ~10 literal `'NGN'` / `as 'NGN'` casts in the execution engine, two
`?? 'TRON'` fallbacks, an NGN-only pricing `baseRate`, NGN-implicit tier limits,
an NGN-named Travel-Rule scalar, a velocity counter with no currency dimension,
NGN-interpolated gate errors, a hard-coded asset/fiat basket in the LLM prompt,
and a frontend with no config-discovery that bakes the NGN/TRON/USDT basket into
constants.

We intend to support multiple currencies and networks **from the start** — i.e.
the model/engine should be currency- and network-agnostic now, even though only
one market is _enabled_ at launch.

## Decisions (locked with the user)

1. **Scope = generic plumbing only.** Thread `fiatCurrency`/`network`/`asset`
   everywhere and delete every NGN/TRON literal, but keep enums **narrow and
   fail-closed** and enable no new market. Adding a market later = a catalog/config
   entry + one enum line, with **zero money-path code changes**. Respects
   PRD §12 (NGN-only launch) and ADR-0006 (USDT-on-TRON).
2. **Per-currency config** for KYC limits, the Travel-Rule threshold, and velocity
   counters. Regulatory limits are set per-currency by ops; the security gate
   **never** depends on a live FX rate, and a user's spend is **not** aggregated
   across currencies.
3. **FE `/config` slice is in this PR** (not deferred).

## Guiding invariant

> Fiat currency is a **value carried on every money shape and threaded through the
> engine** — never a literal in code. This is exactly how `asset` already works
> after WN-4.

Success test for the whole change: **adding a market = a catalog/config entry +
one enum line, with no edits to the money path.**

## What is already generic (the architecture did the hard part)

- **Wallets** are per-network (WN-1).
- The **catalog** (`CatalogAsset`/`CatalogFiat`/`CatalogNetwork` in
  `api/src/core/config/configuration.ts`) is a config-driven, fail-closed registry,
  fronted by **`AssetRegistry`** (`api/src/core/catalog/asset-registry.ts`) which
  already exposes `fiat(code)`, `isFiatEnabled`, `formatFiat` (per-currency symbol +
  decimals, deterministic), `formatCrypto`, `enabledNetworks()`,
  `isCapabilityEnabled`/`requireCapability`, and `defaultCryptoAsset()`.
- The **ledger** threads `asset` (WN-4). `Quote`, `PriceSnapshot`, and
  `TreasuryExposure` all persist `fiatCurrency` (the latter two keyed
  `(asset, fiatCurrency)`).
- The **rate-provider port** `getRate(asset, fiatCurrency)` already takes the fiat arg.

The work therefore concentrates on **fiat currency** + **per-currency config**;
networks/assets are ~90% done.

## Design

### 1. Contracts (`packages/contracts`)

- **Keep** `FiatCurrencySchema = z.enum(['NGN'])`, `NetworkSchema = z.enum(['TRON'])`,
  `SupportedAssetSchema` narrow. Do **not** loosen to `z.string()` — fail-closed is the
  safety property (contracts CLAUDE.md "explicit, additive enum growth").
- **Keep** `.default('NGN')` on intents/tools (single launch currency = ergonomic),
  but audit every money-carrying DTO/response to confirm it **carries `fiatCurrency`
  explicitly** so downstream threads it instead of re-deriving.
- **Fix JSDoc:** "Gross NGN the user paid" → "Gross fiat the user paid, in the order's
  `fiatCurrency`"; keep `"10000"` labelled as an _NGN-at-launch example_, not the contract.
- `FiatAmountSchema` keeps its 2-dp regex (NGN/USD/KES are 2-dp); the catalog's `decimals`
  remains the display source of truth. Documented caveat: a 0-/3-dp currency would need
  this revisited — none at launch.

### 2. Money path — thread `fiatCurrency` like `asset` (the bulk, no behavior change)

- `api/src/modules/transactions/application/execution.service.ts`: replace every literal
  `'NGN'` / `as 'NGN'` (lines ~122, 343, 464, 508, 571, 684, 859, 1674, 1778) with
  `storedQuote.fiatCurrency` (already persisted on `Quote`). The verify check becomes
  `verifyResult.currency !== storedQuote.fiatCurrency`.
- **Remove** the two `?? 'TRON'` fallbacks (~1108, 1445): network comes from the
  per-network wallet/proposal; absence must **fail-closed**, not default to TRON.
- `api/src/modules/transactions/domain/ledger.ts`, `…/ports/settlement.repository.port.ts`
  - the Prisma impl, and receipt copy: thread `fiatCurrency` through the fiat legs exactly
    as `asset` was threaded in WN-4; update the quoted JSDoc.
- Existing NGN tests stay green (NGN still flows through). Add tests asserting the threaded
  value equals the quote's `fiatCurrency` (no literal).

### 3. Config shape — per-currency (the real design content)

All keyed by the catalog fiat **`code`**. JSON defaults ship **NGN entries only**.

- **Pricing** (`PricingConfig.AssetPricing`): `baseRate: number` (scalar) →
  `baseRates: Record<fiatCode, number>`. `ConfigRateProvider.getRate(asset, fiat)` resolves
  `assetPricing.baseRates[fiat]`, **fail-closed** if absent (extends the existing
  missing-asset rejection to the fiat axis). `buySpreadBps`/`sellSpreadBps`/`processingFeeBps`
  stay (bps are currency-neutral); `cryptoDecimals` stays per-asset.
- **Limits** (`LimitsConfig`): nest under fiat first —
  `limits[fiatCode] = { tier_1, tier_2, tier_3 }`. `KycGateService` resolves
  `limits[order.fiatCurrency]` then the tier; **fail-closed** on unknown currency.
- **Travel Rule** (`ComplianceConfig`): `travelRuleThresholdNgn: number` →
  `travelRuleThresholds: Record<fiatCode, number>` (drop the `…Ngn` name).
  `ProposalService` resolves by the proposal's fiat; fail-closed if absent.

### 4. Velocity — per-currency dimension

- `VelocityCounter` (`api/prisma/schema/01-audit.prisma`) gains `fiatCurrency`; the unique
  key becomes `@@unique([userId, counterType, fiatCurrency])` (both AMOUNT*\* and COUNT*\*
  counters, consistent with per-currency limits — **no cross-currency aggregation**).
- Prisma migration + backfill existing rows to `fiatCurrency = 'NGN'` (same backfill pattern
  this branch already uses for wallet networks).
- The velocity read/increment in the KYC-gate path keys on the transaction's currency.

### 5. Strings, agent prompt, FE config discovery

- **KYC-gate error strings** (`KycGateService`): interpolate the currency code/symbol from
  the catalog (`AssetRegistry.fiat(code)` / `formatFiat`), not literal "NGN".
- **LLM prompt** (`api/src/modules/agent/infrastructure/anthropic-llm.provider.ts`, lines
  34–35): render the supported asset/fiat/network basket **from the catalog** (inject
  `AssetRegistry`; the prompt string is built in the infrastructure-layer adapter, which is
  allowed to depend on the registry). Content-only change — **§3.1-safe** (no money moves).
- **`/config` endpoint** (mandated by CLAUDE.md §7): a thin, **non-secret** read endpoint in a
  presentation controller backed by `AssetRegistry`, exposing enabled currencies/networks/
  assets (code, symbol, decimals, display name) + effective tier limits. Shape defined once in
  `@handshake-agent/contracts` (`dto/`). FE reads it via TanStack Query (sensible `staleTime`),
  stores nothing secret, and **templatizes the ₦/NGN copy** from it (replacing the hard-coded
  basket constants). FE forms/components stay pure (lift discovery into a `lib/` query hook).

### Invariants preserved

- **§3.1** — prompt change is content; pricing/limits/travel-rule resolvers are deterministic.
- **§3.3** — server-side gate stays; now resolved **per currency**.
- **§7** — config-driven, fail-closed; enums stay narrow so prod cannot accept an
  unconfigured currency. New value → env/JSON/AppSetting per the decision rule, never hardcoded.
- **§3.2** — `/config` endpoint reads via `AssetRegistry`/config, not the agent; no new DB
  coupling in the agent.

## Sequencing (each step independently shippable; suite green throughout) — strict TDD

1. **Money-path cleanup** — thread `fiatCurrency`, delete NGN/TRON literals + fallbacks, fix
   port JSDoc. No behavior change.
2. **Config + resolvers** — per-fiat `baseRates`, per-fiat limits, per-fiat travel-rule. New
   resolver tests feed a **second-currency config fixture** (config maps are keyed by string,
   not the narrow enum) to prove resolution is data-driven, not NGN-special-cased.
3. **Velocity per-currency** — Prisma migration + gate change + backfill default.
4. **Strings + prompt-from-catalog.**
5. **FE `/config` endpoint + contracts DTO + templatized FE copy.**

## Out of scope (explicit)

- Enabling any second currency or network (no new FX feed, provider/custody, or compliance work).
- Loosening the narrow enums.
- Multi-currency precision beyond 2 dp (no 0-/3-dp currency at launch).
- Cross-currency velocity aggregation.

## Test strategy

- **Money path:** assert threaded value == quote `fiatCurrency` (no literal); existing NGN
  fixtures stay green.
- **Resolvers (pricing/limits/travel-rule):** unit tests with a fabricated second-currency key
  in the config fixture, proving data-driven resolution + fail-closed on unknown currency.
- **Velocity:** integration test (Testcontainers Postgres) proving counters are isolated per
  `(userId, counterType, fiatCurrency)`; backfill migration test.
- **`/config`:** e2e (supertest) asserting the endpoint returns only enabled, non-secret catalog
  entries; contracts schema parse tests for valid/invalid fixtures.
- ~100% coverage on touched domain/application/engine code (root §9).

## Key files

- `packages/contracts/src/common.ts`, `…/intents/*`, `…/tools/*`, `…/dto/*`
- `api/src/modules/transactions/application/execution.service.ts`
- `api/src/modules/transactions/domain/ledger.ts`
- `api/src/modules/transactions/application/ports/settlement.repository.port.ts` + impl
- `api/src/modules/quotes/infrastructure/config-rate.provider.ts`,
  `…/application/ports/rate-provider.port.ts`
- `api/src/core/config/configuration.ts` (`PricingConfig`, `LimitsConfig`, `ComplianceConfig`,
  JSON defaults)
- `api/src/modules/identity/application/kyc-gate.service.ts`
- `api/src/modules/transactions/application/proposal.service.ts`
- `api/prisma/schema/01-audit.prisma` (`VelocityCounter`) + migration
- `api/src/modules/agent/infrastructure/anthropic-llm.provider.ts`
- `api/src/core/catalog/asset-registry.ts` (consumed, not rewritten)
- new `/config` presentation controller + contracts DTO
- `web/` currency-format helpers, basket constants, new config query hook
