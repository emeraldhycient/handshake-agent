# Real Providers, Multi-Asset / Multi-Currency & Blockradar Swap — Design

> Status: **approved** (2026-06-29) · Branch: `feat/web-agent-vertical`
> Read order: root [`CLAUDE.md`](../../../CLAUDE.md) → [`api/CLAUDE.md`](../../../api/CLAUDE.md) → [`web/CLAUDE.md`](../../../web/CLAUDE.md) → this spec.

## 1. Goal

Three coupled changes under one principle the user made binding: **the product is multi-asset and
multi-currency from the start, and every external integration is real except where no provider or
credential exists yet.**

1. **De-mock** every external capability that has a real provider + credential. After this, only
   **KYC** and (until a Whisper key is added) **voice transcription** remain mock.
2. Make contracts / engine / agent / UI **genuinely multi-asset and multi-currency** — remove every
   single-asset / NGN hardcode. The _live_ set stays governed by catalog `enabled` flags + real rails
   (**config-gated; no fake settlement**).
3. Add a real **crypto↔crypto swap** vertical via **Blockradar** (USDT↔TRX on TRON as the first pair).

**Non-goals (deferred):** a live FX-rate feed (per-currency base rates stay config/admin-tunable);
fiat pay-in/payout rails for non-NGN currencies (RWF etc. quote but report "not live yet"); real KYC
and real transcription (no credential yet).

## 2. Baseline (what exists)

- **Provider-port + flag pattern** already used for payment (`selectPaymentProvider`/`PAYMENTS_MOCK_MODE`),
  wallet (`WALLET_MOCK_MODE`), sanctions (`SANCTIONS_MOCK_MODE` → `BlockradarAmlScreener`), and media
  (`TRANSCRIPTION_MOCK_MODE`, `MEDIA_EXTRACTION_MOCK_MODE`). Real adapters exist for AML and Claude-vision.
- **Hardcoded mocks (no flag):** `MockKycProvider` (`identity.module`), `MockNameEnquiry` (`beneficiaries.module`),
  `MockEmailProvider` (`auth.module`; `RESEND_API_KEY` empty, no real adapter).
- **`ConfigRateProvider`** returns a static base rate from config (`pricing.assets.<sym>.baseRates.<fiat>`),
  only NGN populated. Not a live feed.
- **Swap scaffold is wrong:** `SwapIntentSchema = { fromAsset, toCurrency: FiatCurrency.default('NGN'), amount }`
  (crypto→fiat — a sell). `crypto.swap: false`. Catalog registers **only USDT/TRON/NGN**.
- **Webhooks:** `POST /webhooks/blockradar` (deposits, sends), `POST /webhooks/flutterwave` (buy/sell).
  `BLOCKRADAR_WEBHOOK_SECRET` currently **empty**.
- **Web:** `NEXT_PUBLIC_USE_MOCK=true` → wallet/activity/deposit pages read mock fixtures (chat bypasses it).

## 3. Invariants (reaffirmed — swap is no exception)

- **§3.1 model proposes / engine disposes:** the agent emits a `SwapIntent`; `ProposalService.createSwapProposal`
  re-validates; `DirectiveService` requires **PIN + step-up**; `ExecutionService.executeSwap` is the **only**
  caller of Blockradar execute; idempotency via the swap `reference`.
- **§3.3 server-side gating:** KYC tier + limits + velocity + sanctions checked on the swap's fiat value.
- **FX spread / platform margin is NEVER surfaced** — swap shows rate + fees + ETA, no spread line.
- Secrets only in env; AML and webhook secrets never logged.

## 4. Phase 1 — De-mock to real

- Flip `SANCTIONS_MOCK_MODE=false` (Blockradar AML) and `MEDIA_EXTRACTION_MOCK_MODE=false` (Claude-vision).
- **Build `FlutterwaveNameEnquiry`** implementing `BANK_NAME_ENQUIRY` (Flutterwave `POST /accounts/resolve`
  `{account_number, account_bank}` → `account_name`). Bind via `useFactory` on a new `NAME_ENQUIRY_MOCK_MODE`
  flag (default mock; real on `'false'`), mirroring `selectPaymentProvider`.
- **Build `ResendEmailProvider`** implementing `EMAIL_PROVIDER` (Resend API, `from = EMAIL_FROM`). Selected by
  `RESEND_API_KEY` presence (falls back to `MockEmailProvider` until the key is set); `auth.module` binds via factory.
- **Wire `BLOCKRADAR_WEBHOOK_SECRET`** into the blockradar-webhook signature verification (required for send **and**
  swap settlement). User supplies the secret.
- **Flip `NEXT_PUBLIC_USE_MOCK=false`**; live-verify wallet / activity / deposit against the real backend.
- **Stays mock (documented):** KYC (`MockKycProvider`), transcription (no Whisper key).
- **Tests:** adapter unit tests (mock the HTTP client), flag-selection tests; existing e2e unchanged.

## 5. Phase 2 — Multi-currency (config-gated)

- `common.ts`: widen `FiatCurrencySchema` → `NGN, GHS, KES, UGX, TZS, RWF, ZAR, USD` (the _possible_ set);
  rewrite the "narrow launch / NGN only" comment to describe config-gating.
- `configuration.ts`: `fiats` gains an entry per currency (`decimals`, `symbol`, `enabled` — **only NGN enabled**);
  `pricing.assets.<sym>.baseRates` gains per-currency rates (placeholder/admin-tunable; only NGN authoritative);
  `compliance.travelRuleThresholds` becomes a per-currency map.
- `AssetRegistry`: `enabledFiats()`, `fiat(code)`, `isCurrencyLive(code)`.
- Agent prompt (`anthropic-llm.provider`): list **enabled-and-live** fiats; accept any `SupportedFiat`; never say "NGN only".
- New `AgentTurnOutcome` variant **`{ kind: 'currency_not_live', currency }`** → graceful message
  ("RWF isn't available yet — we currently settle in NGN"). No quote, no fake settlement.
- Engine: quoting is already currency-parametric (`baseRates` map); remove any residual NGN literal; thread
  `fiatCurrency` through buy/sell proposals + confirmations.

## 6. Phase 3 — Multi-asset (config-gated)

- Catalog `assets` gains **TRX** `{ symbol:'TRX', kind:'crypto', decimals:6, networks:['TRON'],
providers.blockradar.assetId: <user-supplied>, enabled:true }`; `pricing.assets.TRX.baseRates` for valuation.
  Remove single-asset assumptions + misleading comments.
- `AssetRegistry` already enumerates — verify N-asset (`enabledCryptoAssets`, `defaultNetworkFor`, `asset(sym)`).
- Balance tool + wallet enumerate enabled assets → TRX appears automatically.
- **Dependency:** TRX Blockradar `assetId` (user provides from dashboard).

## 7. Phase 4 — Swap vertical (Blockradar)

- **Contracts:** `SwapIntentSchema → { action:'swap', fromAsset, toAsset, amount }` (`.refine` fromAsset ≠ toAsset).
  `SwapQuote` + `SwapProposalConfirmation` `{ fromAsset, toAsset, fromAmount, toAmount, rate, networkFee,
transactionFee, estimatedArrivalSec, expiresAt }`.
- **`SWAP_PROVIDER` port:** `getQuote({fromAssetId,toAssetId,amount,order})` → `SwapQuote`;
  `execute({fromAssetId,toAssetId,amount,reference,order})` → `{ providerSwapId, status, hash? }`. Adapters:
  `BlockradarSwapProvider` (`POST /v1/wallets/{walletId}/addresses/{addressId}/swaps/{quote,execute}`, `x-api-key`)
  - `MockSwapProvider`; `SWAP_MOCK_MODE` flag (default mock). `crypto.swap` capability → `true` once the real
    provider + ≥2 enabled assets are bound.
- **Pricing:** Blockradar quote yields rate/amounts/fees (`networkFee`, `transactionFee`, `slippage`). Platform
  margin via a config `swapSpreadBps` folded into the displayed rate (**never surfaced**). `maxDriftBps` re-quote at execute.
- **Engine:** `createSwapProposal` (fromAsset balance sufficiency, KYC/tier/velocity/sanctions on the swap fiat-value,
  `getQuote`, persist `Proposal(txType:swap)`, return confirmation) → `DirectiveService.issue` (PIN + step-up,
  device-bound like send) → `executeSwap` (consume directive, `reference` = idempotency, `provider.execute`,
  `Transaction(swap, settling)`, ledger debit `fromAsset`) → **webhook settle** credits `toAsset`, marks completed.
- **Settlement:** blockradar-webhook learns swap events (by `reference`/type) → `settleSwap`. Needs `BLOCKRADAR_WEBHOOK_SECRET`.
- **Routing:** `web-chat.service` + `conversation.service` `swap` case → `createSwapProposal` when `crypto.swap` live,
  else graceful `not_supported`. Generic `chat/proposals/:id/{authorize,execute}` handle `txType: swap`.
- **FE:** `SwapCard` (from/to assets, amounts, rate, fees, ETA) reusing `ConfirmSheet` + `PinPad` + settling/result
  cards; mapping in `lib/chat/agent-outcome.ts`.

## 8. Config & credentials

- New env (Zod-validated, fail-boot): `NAME_ENQUIRY_MOCK_MODE`, `SWAP_MOCK_MODE`, email selection
  (`RESEND_API_KEY` presence). User-provided: **`BLOCKRADAR_WEBHOOK_SECRET`**, **`RESEND_API_KEY`**,
  **TRX Blockradar `assetId`**. `.env.example` updated.

## 9. Testing & gates

Strict TDD; ~100% coverage on the engine + new provider adapters (mock the HTTP client). `depcruise` clean;
api unit + e2e, web unit, contracts all green. Card tests assert **no FX-spread line**.

## 10. Sequencing

**1 → (2 ∥ 3) → 4.** Phase 1 (config + two small adapters) unblocks real end-to-end testing; swap depends on 2+3.
Each phase is independently green-gated and committed. The two earlier drift fixes (balance valuation → sell rate,
sidebar/topbar → real profile) land in parallel.
