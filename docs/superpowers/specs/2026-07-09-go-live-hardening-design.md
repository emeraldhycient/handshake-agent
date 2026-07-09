# Go-live hardening — design addendum (2026-07-09)

Follow-up to `2026-07-08-go-live-program-design.md` / PR #115. Eight items from that PR's
enhancement plan, now decided and scoped from a 4-agent recon of the actual code. Branch
`feat/go-live-hardening` (stacked on `feat/go-live-program`). Funds-safety invariants (§3) binding.

Recon corrected three naive assumptions — each is load-bearing below.

## Wave F — pricing feed (no mock) · argon2id PIN · registry hot-reload · AML boot guard (api)

### F1 — Live market-rate feed (the biggest financial risk)
**Correction:** the execution engine and swap cross-rate do **not** go through `IRateProvider` —
they read `pricing.assets.<asset>.baseRates.<fiat>` directly from `EffectiveConfigService`
(`resolve-base-rate.ts:24`, `proposal.service.ts`, `execution.service.ts`, `mock-swap.provider.ts`).
A feed wired only behind `ConfigRateProvider` makes the **quote** live but the **execution re-quote**
stale → drift-check failures and wrong KYC fiat-equivalent. So the live rate must be visible at the
**single base-rate resolution seam both paths share**, not just in the quote adapter.

Design:
- `LiveRateStore` (injectable, in-memory): `{asset,fiat} → {rate, fetchedAt, source, degraded}`.
- `LiveRateService` (scheduled poll, `@Interval`/`@Cron` like the existing sweepers): fetches
  **CoinGecko** (`/simple/price` batched over the catalog), **Quidax** public ticker for USDT/NGN,
  and **open.er-api.com** for fiat legs; computes per-(asset,fiat) rates; validates **freshness**
  (age ≤ `pricing.feed.stalenessSec`) and **divergence** (|live − config fallback| ≤
  `pricing.feed.divergenceBps`); writes fresh values to the store, marks degraded otherwise.
- A shared `resolveEffectiveBaseRate(config, store, asset, fiat)` helper: **live store value when
  fresh, else the config `baseRates` fallback** (the admin kill-switch/floor). Route **all** base-rate
  reads through it — `ConfigRateProvider.getRate`/`getValuationRate`, `resolve-base-rate.ts`, the
  direct `config.get('pricing')` reads in proposal/execution, and mock-swap cross-rate — so quote and
  execution always agree.
- **No mock mode.** The service always runs. `pricing.feed.enabled` (admin config, default true) is
  the kill-switch → falls back to config rates. In local/dev without network, fetches fail → degraded
  → config fallback (visual-verify still works).
- **Alerting:** on staleness/divergence/fetch-failure, surface through the existing operator
  system-health path (mirror the 45s-TTL single-flight `CachedProviderConnectivityAdapter` +
  MetricsOps system-health card); log at warn. No new alert table.
- Config: `pricing.feed.{enabled, pollIntervalSec, stalenessSec, divergenceBps, sources}`; env:
  `COINGECKO_API_KEY` (optional), `COINGECKO_BASE_URL`, `QUIDAX_BASE_URL`, `EXCHANGERATE_BASE_URL`
  (all with sane defaults). Reuse the Flutterwave/Blockradar axios pattern (HttpService, timeout,
  `wrapError`). This is money-path → **adversarial review before commit**.

### F2 — argon2id PIN migration (R4)
`core/auth/pin.service.ts` hashes with scrypt (`TODO(SEC)`). Migrate to **argon2id** (already used
for admin passwords). Self-describing hash format: `verifyPin` accepts legacy scrypt **and** argon2id;
on a successful scrypt verify, **re-hash to argon2id** and persist (opportunistic migration). New PINs
argon2id. The atomic TOCTOU-safe lockout counter is untouched.

### F3 — AssetRegistry hot-reload of catalog toggles
`AssetRegistry` snapshots `ConfigService` at boot, so admin catalog kill-switch toggles
(`catalog.fiats.<code>.enabled`, `catalog.assets.<sym>.enabled` — persisted + audited in PR #115)
don't affect money-path liveness until restart. Change the registry to read the **hot-reloaded**
`EffectiveConfigService` for `isCurrencyLive`/`isFiatEnabled`/`isAssetLive`/`enabledFiats` so a toggle
takes effect immediately (the settings write already calls `effectiveConfig.refresh()`).

### F4 — AML/sanctions prod boot guard
AML is done by Blockradar (`BlockradarAmlScreener`, selected when `SANCTIONS_MOCK_MODE=false`). Add a
`superRefine` guard: reject boot when `NODE_ENV=production` and `SANCTIONS_MOCK_MODE=true` (mirror the
existing `RESEND_API_KEY`/`STATEMENT_SIGNING_KEY` guards). Screen-nothing must be impossible in prod.

## Wave G — beneficiary currency/country + Flutterwave bank lists + step-up on add (api+contracts+web+wa)

**Correction:** Flutterwave `GET /banks/{country}` is real and country-parameterized, but
`/accounts/resolve` (name-enquiry) is effectively **NGN/NUBAN-only**. So name-enquiry becomes
**country-gated**: resolve where supported (NG), else persist the user-entered name with
`verificationStatus='unverified'` instead of failing closed.

- Contracts: `Beneficiary` + `AddBankAccountRequest` gain `country` (ISO alpha-2) + `currency`
  (`FiatCurrencySchema`); `BankListResponse` (`[{name, code}]`).
- Prisma: `Beneficiary.bankCountry`/`payoutCurrency` (nullable TEXT, app-validated); migration
  backfills existing bank rows to `NG`/`NGN`.
- Config: add `country` to `CatalogFiat` (NGN→NG, GHS→GH, KES→KE, UGX→UG, TZS→TZ, RWF→RW, ZAR→ZA,
  USD→US); expose `AssetRegistry.countryForFiat(code)`. Enabling a market stays a flag flip (§7).
- API: `IBankListProvider` port + `FlutterwaveBankList` adapter (`GET /banks/{country}`, same
  `Bearer FLUTTERWAVE_SECRET_KEY` pattern, per-country cache); `GET /beneficiaries/banks?country=`
  endpoint (JwtAuthGuard). **Real, no mock** (a mock adapter for tests only, gated like name-enquiry).
- **R2 step-up on add:** `addBankAccount`/`addCryptoAddress` now require **PIN + fresh step-up**
  (mirror the send directive/step-up chain) before persisting a withdrawal destination. WhatsApp
  `beneficiary_add` already runs inside the E2E Flow — thread the PIN there.
- Sell routing: guard that the chosen bank beneficiary's `payoutCurrency` matches the sell
  `fiatCurrency` (typed mismatch error); the needs-beneficiary picker filters to matching-currency
  banks so a non-NGN sell prompts "add a {currency} bank" instead of dead-ending.
- Web `add-bank-form`: country selected first (default the user's currency's country), banks fetched
  from the endpoint via TanStack Query; `NIGERIAN_BANKS` kept only as offline fallback.
- **Note (ops):** actual non-NGN payout-rail body shapes are a per-market task; this wave delivers the
  schema/plumbing + NGN correctness + graceful non-NGN add.

## Wave H — HttpOnly refresh cookie (R1) — isolated, highest auth risk

**Scope (recon-confirmed):** access token and `JwtAuthGuard`/PAT bearer flows are **untouched**; only
the web **refresh token** (`localStorage['ha.refreshToken']`) and the web-admin **session JWT**
(`sessionStorage['ha.admin.session']`) move to HttpOnly cookies.

- API: `cookie-parser` added. Web `/auth/login/verify` + `/auth/refresh` **Set-Cookie** the refresh
  token (HttpOnly, `Secure` in prod, `SameSite=Lax` default — works for localhost:3000↔:3001 and
  same-registrable-domain prod; configurable to `None`+`Secure` for cross-site); `/auth/refresh`
  reads the cookie (still **accepts a body token as fallback** so e2e/non-browser keep working);
  `/auth/logout` `clearCookie`. Admin login Set-Cookies the session JWT; `AdminSessionGuard` reads
  **cookie-or-header**; admin logout clears it. Bodies still return tokens (non-breaking) — the
  browsers simply **stop persisting** them.
- CORS: `credentials: true` + an **exact origin allowlist** (`WEB_APP_BASE_URL` + new
  `ADMIN_APP_BASE_URL`), never `*`.
- Web/web-admin: axios `withCredentials: true`; stores drop all localStorage/sessionStorage token
  handling (keep access token / identity in memory); `/auth/refresh` called with no body.

## Wave I — adopt four-eyes for config writes (web-admin + api verify)

**Correction:** exactly **three** surfaces have a real approval kind and must become dual-control;
`tier_override`'s true home is the **limits editor** (writes a `limits.<tier>` settings key), not the
per-user tier change.

- `use-pricing-editor` → `kind:'pricing_change'`; `use-capability-toggles` → `kind:'capability_flip'`;
  `use-limits-editor` → `kind:'tier_override'`. Each: swap the immediate `PATCH /admin/settings/:key`
  for `useCreateChange({kind, resource:key, payload:{key,value,scope,scopeValue}, reason})`, set
  `MakerCheckerModal mode='dual-control'`, **capture the required `reason`** (min 3 — the hooks
  currently discard it), change success copy to "Submitted for approval", drop optimistic invalidation.
- `applyConfigChange` already handles all three (spec-verified) — **no api change**. Surfaces with no
  kind (generic settings, currency/asset enable, per-user tier) **stay immediate** with the honest
  copy from PR #115; fix the stale `use-user-detail` docstring.

## Wave J — CI hardening + reproducible infra

- Commit `docker-compose.dev.yml` (Postgres :5544, Redis :6379) + a seed script for the QA users.
- `ci.yml`: add an **api e2e lane** (service Postgres, `test:e2e`), **coverage thresholds** (api jest
  on `domain`+`application`; web/web-admin vitest), `pnpm format:check`, and a **commitlint** step.
- **Fix** the two known-red e2e suites (`send-vertical` velocity 6>5, `admin-end-users` tier) so the
  e2e lane is green; quarantine only with a documented reason if a fix proves out of scope.

## Wave K — agent + MCP rate-quote tool (added 2026-07-09)

A read-only discovery tool so an agent (web/WhatsApp) or an external MCP client can answer "what's the
USDT→NGN rate?" and "show me every rate". No money movement — pure display.

**Rate model (user decision: both directions per pair).** For each `(asset, fiat)` pair the tool returns
**two single folded numbers** — a **buy** rate and a **sell** rate — each = the base rate ± our FX spread,
folded into one figure (the spread is *not* itemized to the user):
- `sellRate` (crypto→fiat, "USDT → NGN"): what the user receives per 1 unit of crypto, computed with the
  same `sellSpreadBps` the sell quote uses.
- `buyRate` (fiat→crypto): the price to acquire 1 unit of crypto, computed with the same `buySpreadBps`
  the buy quote uses.

**Reuse, don't reinvent.** The displayed rate MUST equal what the engine actually transacts at, so the
tool resolves the base rate through the Wave F seam (`resolveEffectiveBaseRate` → live store when fresh,
config floor otherwise) and applies the spread through the **existing** quote math
(`computeBuyQuote`/`computeSellQuote` or the shared spread helper in `quotes/application`), not a
parallel calculation. Only pairs that are (a) `fiatTradeable`, (b) have a configured/live base rate, and
(c) whose asset **and** fiat are enabled in the **hot-reloaded** `AssetRegistry` appear.

**Surface:**
- `application` (quotes module): a `RatesService.getEffectiveRate(asset, fiat)` returning
  `{ asset, fiat, buyRate, sellRate, source: 'live'|'config', asOf }` and `listEffectiveRates()` over all
  enabled `asset × fiat` combinations.
- **Agent tool** (`agent` module tool registry, read-only, alongside `check_balance`): `get_rate` and
  `list_rates`, so the model can answer rate questions and render "all combinations".
- **MCP** (`mcp` module, **read scope only**): `get_rate({asset, fiat})` and `list_rates()` — no execute,
  no PIN (§3.1/§3.5 unchanged; this is read-only).
- **Contracts:** `EffectiveRateSchema` + `RateListResponseSchema` (folded numbers only — never expose the
  raw spread bps to the user surface, though the admin console keeps its per-bps view).

Funds-safety: read-only; the tool proposes nothing and moves nothing. It shares the pricing seam so a
degraded/kill-switched feed shows the config-floor rate (and can flag `source: 'config'`).
