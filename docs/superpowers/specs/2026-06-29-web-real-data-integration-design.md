# Web real-data integration — design

**Date:** 2026-06-29
**Branch base:** `feat/web-agent-vertical` (worktree)
**Status:** approved-pending-review
**Related:** [`2026-06-28-web-agent-vertical-design.md`](2026-06-28-web-agent-vertical-design.md), root `CLAUDE.md` §3/§4/§5/§8, `web/CLAUDE.md`

---

## 1. Context & problem

The web app's read surfaces — the mobile **wallet tab** and **activity tab**, and the desktop **overview / wallet / activity / tickets / settings** pages — already render through TanStack Query hooks (`useBalances`, `useWalletAssets`, `useActivity`, `useDepositAddress`, `useNotifications`, `useEvents`) with the required four async branches. But those hooks resolve through a **mock gateway** (`web/lib/api/gateway.ts` → `web/lib/api/mock/index.ts` → `web/lib/api/fixtures.ts`). `NEXT_PUBLIC_USE_MOCK` defaults `true`, so every read is fixture data.

Auth, KYC, and chat→agent are live (see related spec). The gap is purely the **read data layer**: there are no JWT-authed backend endpoints for wallet balances, transaction history, deposit address, notifications, or a settings profile, and the gateway never switches to real for authenticated users.

## 2. Goals

- JWT-authed backend READ endpoints, server-side per-user filtered, for: wallet balances + per-asset breakdown, transaction/activity list, deposit address, notifications, and a settings profile (incl. tier limits).
- Shared **structured** response DTOs in `@handshake-agent/contracts` (data, not presentation).
- Wire the FE `realGateway` to those endpoints, mapping structured data → the existing presentation "view" shapes in a thin, unit-tested FE mapping layer. Components and hooks stay unchanged.
- Drive service visibility (Tickets, Swap) from `/config` capabilities.
- Make Settings real (email, name/phone when present, KYC tier, daily limit). Drop fabricated identity values.
- Switch authenticated users off mock, keeping mocks for the test suite.
- Strict TDD throughout; live browser verification with a logged-in KYC-verified user.

## 3. Non-goals

- No new money-moving paths. This is **reads only** (the existing buy/sell execute endpoints are untouched). §3.1 model-proposes/engine-disposes is unaffected.
- No ticketing backend (deferred). Events/tickets stay mock and are hidden by capability.
- No price-history / P&L service. Unbacked display metrics (per-asset 24h change, desktop Price/24h, the "today" delta line) are **kept as clearly-labelled placeholder constants** (product decision), not derived.
- No web `send` execution (already deferred to WhatsApp).
- No real biometric/PIN-change backend for Settings (those controls remain UI-only stubs).

## 4. Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| D1 | Wire shape | **Structured backend DTOs + FE mapping.** Backend never emits formatted strings / hex / glyphs. |
| D2 | Holdings valuation | **Live sell rate** — `effectiveSellRate = baseRate × (1 − sellSpreadBps/10000)`, spread folded in and never shown. Fee-**exclusive** (realizable rate, not a fee-adjusted sell preview). |
| D3 | Unbacked metrics | **Keep demo placeholders** (24h change, Price/24h, "today" delta), as commented placeholder constants. |
| D4 | Scope | **Everything now** — money-core + notifications + real Settings + capability gating. |
| D5 | Settings identity | Show **email always**; show **name and phone when they exist**, else fall back to email as display name and omit phone. |
| D6 | Mock removal | Keep `NEXT_PUBLIC_USE_MOCK` flag; **code default stays `true`** (Vitest stays on mock); `web/.env.local` and prod env set `false`. Not-yet-backed methods (`getEvents`, `getSearchCatalog`) delegate to mock. |

## 5. Backend

All endpoints: `@UseGuards(JwtAuthGuard)`, `@CurrentUser() user: AuthenticatedUser`, filtered by `user.userId`. Response parsed/serialized via `@handshake-agent/contracts` schemas (`createZodDto` not required for GET responses, but responses are `.parse()`-validated before return, mirroring the existing `PublicConfigController` and `TransactionStatusController`).

### 5.1 `GET /wallets/balances` → `WalletBalancesResponse`

- New `WalletController` in `api/src/modules/wallets/presentation/` (the module currently only has the Blockradar webhook controller).
- New application service `WalletBalanceService` (or method on `WalletService`) that, per enabled asset:
  - reads the per-asset balance (from `WalletBalance` snapshots via a new repo read; provider sync stays as-is),
  - values it at the **live sell rate** using `IRateProvider.getRate(asset, fiat)` + the pure `quote-pricing` math (new tiny pure helper `valueAtSellRate(amount, baseRate, sellSpreadBps)` in `quotes/domain`, fee-exclusive),
  - sums `totalFiatValue`.
- Assets with a zero balance are still listed (so the wallet shows the basket); NGN is **not** a holding (no fiat custody) — only crypto assets appear.

```ts
// packages/contracts/src/dto/wallet.dto.ts
export const WalletAssetBalanceSchema = z.object({
  symbol: SupportedAssetSchema,        // "USDT"
  displayName: z.string(),             // "Tether USD"
  network: z.string(),                 // "TRON"
  amount: CryptoAmountSchema,          // "29.97" (asset-native major units, string)
  decimals: z.number().int().nonnegative(),
  fiatValue: FiatAmountSchema,         // "49150.00"
});
export const WalletBalancesResponseSchema = z.object({
  fiatCurrency: FiatCurrencySchema,    // "NGN"
  totalFiatValue: FiatAmountSchema,    // "72340.00"
  assets: z.array(WalletAssetBalanceSchema),
});
```

### 5.2 `GET /wallets/deposit-address?network=TRON` → `DepositAddressResponse`

- On `WalletController`. Default network = the single enabled network when `network` omitted.
- Reuses `WalletService.getOrProvisionNetworkWallet(userId, network)` → `Wallet.address`. `networkLabel` and `minDeposit` come from the catalog/config (no hardcoding).

```ts
// packages/contracts/src/dto/wallet.dto.ts
export const DepositAddressResponseSchema = z.object({
  asset: SupportedAssetSchema,         // "USDT"
  network: z.string(),                 // "TRON"
  networkLabel: z.string(),            // "TRON · TRC-20"
  address: z.string().min(1),
  minDeposit: z.string().optional(),   // "1"
});
```

### 5.3 `GET /transactions?limit=&cursor=` → `TransactionListResponse`

- Add `@Get()` to the **existing** `TransactionStatusController` (same module/controller that owns `GET /transactions/:id`). No route conflict (`/transactions` vs `/transactions/:id`).
- Add `findByUserId(userId, { limit, cursor }): Promise<TransactionRecord[]>` to `ITransactionRepository` + the Prisma impl (order by `createdAt desc`, keyset paginate on `createdAt,id`).
- Item fields extracted from `transaction.metadata` exactly as the existing status endpoint does (`asset`, `cryptoAmount`, `fiatAmount`, `fiatCurrency`, plus `counterparty`/`destination` when present). `direction` is **derived in the FE** from `type` — not stored — so the wire stays minimal.

```ts
// packages/contracts/src/dto/transaction.dto.ts
export const TransactionListItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),                    // buy | sell | send | receive | deposit | ticket_purchase | ...
  status: z.string(),                  // pending | settling | completed | failed | ...
  asset: z.string().optional(),
  cryptoAmount: z.string().optional(),
  fiatAmount: z.string().optional(),
  fiatCurrency: z.string().optional(),
  counterparty: z.string().optional(), // destination/sender, when known
  createdAt: z.string(),               // ISO 8601
});
export const TransactionListResponseSchema = z.object({
  items: z.array(TransactionListItemSchema),
  nextCursor: z.string().optional(),
});
```

### 5.4 `GET /notifications?limit=` → `NotificationListResponse`

- New minimal `notifications` feature module (`presentation` + `application` + `infrastructure` + port), clean-arch layered. Reads `Notification` rows for the user, newest first.
- Returns structured rows; the FE maps `eventType` → icon/title and `templateVars` → body text. `eventType`/`eventRef`/`createdAt`/`templateVars` are passed through; no template rendering on the backend for the in-app feed.

```ts
// packages/contracts/src/dto/notification.dto.ts
export const NotificationItemSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),               // transaction_completed | kyc_approved | ...
  eventRef: z.string(),
  createdAt: z.string(),               // ISO 8601
  templateVars: z.record(z.unknown()), // for FE body rendering
});
export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationItemSchema),
});
```

### 5.5 `GET /profile` → `ProfileResponse`

- New endpoint in the `identity` module (`ProfileController` + `ProfileService`), or extend identity presentation. Composes:
  - `email`, `kycStatus`, `kycTier` (from `User`),
  - `fullName` from `KycProfile.firstName`+`lastName` when present (`String?`),
  - `phone` from the user's `ChannelIdentity` (`channelAddress`/`normalizedPhone`) when present,
  - `limits` from `ConfigService` `getTierLimits(fiat, kycTier)` (`perTxFiatMax`/`dailyFiatMax`/`dailyTxCountMax`). For `unverified` tier there are no limits → `limits: null`.

```ts
// packages/contracts/src/dto/profile.dto.ts
export const ProfileLimitsSchema = z.object({
  perTxFiatMax: z.number(),
  dailyFiatMax: z.number(),
  dailyTxCountMax: z.number(),
});
export const ProfileResponseSchema = z.object({
  email: z.string().email(),
  fullName: z.string().nullable(),     // null when KYC names absent
  phone: z.string().nullable(),        // null when no channel identity
  kycStatus: z.string(),
  kycTier: z.string(),
  fiatCurrency: FiatCurrencySchema,
  limits: ProfileLimitsSchema.nullable(),
});
```

### 5.6 Capabilities

`GET /config` already returns `capabilities` (real keys: `crypto.buy/sell/send/receive` = true, `crypto.swap` = false, no `ticketing` key → fail-closed false). No backend change; the FE consumes it.

## 6. Frontend

### 6.1 Mapping layer (pure, unit-tested) — `web/lib/api/mappers/`
- `mapWalletBalances(res): BalanceView` and `mapWalletAssets(res): WalletAsset[]` — format amounts/values, apply `ASSET_TINTS`, attach the placeholder `change` constant.
- `mapTransactions(res): ActivityGroup[]` — group by calendar day (Today/Yesterday/`DD Mon`), derive `dir` from `type`, `statusTone` from `status`, glyph/tint from `type`, build the `sub` line (time · amount / counterparty).
- `mapNotifications(res): AppNotification[]` — `eventType` → icon/title/tint, `templateVars` → `sub`, `createdAt` → relative `time`.
- `mapDepositAddress(res): DepositView`.
- `web/lib/format/money.ts` — `formatFiat`/`formatCrypto` using `/config` symbol+decimals (no hardcoded ₦/decimals).

### 6.2 Gateway — `web/lib/api/gateway.ts`
- `realGateway` methods call the real endpoints, `.parse()` the contract DTO, return `map*(...)`. `getEvents` + `getSearchCatalog` delegate to `mock` (documented: no backend; hidden by capability). `createQuote`/`executeTransaction` unchanged (chat flow already live).

### 6.3 Capability gating
- Derive a small `useCapabilities()` selector from `useConfig()`. Hide **Tickets** nav (mobile `mobile-tabbar`, desktop `dashboard-sidebar`) and the **Swap** quick-action when the capability is false. Quick-action → capability key map: `buy→crypto.buy`, `send→crypto.send`, `receive→crypto.receive`, `swap→crypto.swap`.

### 6.4 Page edits
- **Wallet page** deposit panel: use `useDepositAddress()` (drop the `DEPOSIT_ADDRESS` constant). Keep the existing QR component.
- **Overview hero**: use `useBalances().data.total` (drop hardcoded `₦72,340.00`); keep the placeholder "today" delta line (D3).
- **Settings page**: add `useProfile()` with four branches; render name (or email fallback) + phone (when present) + KYC tier badge + real daily limit; drop the hardcoded `Amara Okeke` / `+234…` / `₦5,000,000`. PIN "Change"/Face-ID remain stubs.
- All other pages already consume hooks — no structural change; they benefit automatically once the gateway is real.

### 6.5 Env
- `web/.env.local`: `NEXT_PUBLIC_USE_MOCK=false`. Code default unchanged (`true`).

## 7. Testing (strict TDD, red→green→refactor)

- **Contracts:** valid/invalid fixture parse tests for every new schema (§9 contracts lane).
- **Backend unit:** `valueAtSellRate` math; `WalletBalanceService` (mocked rate + balances); `findByUserId` mapping; `ProfileService` (name/phone present & absent, limits per tier incl. `unverified`→null); notifications read service. ~100% on this logic.
- **Backend e2e:** supertest + Testcontainers, authenticating a verified JWT user (mirror `api/test/auth.e2e-spec.ts` bootstrap + provider fakes) for each endpoint — happy path, empty, and 401-unauthed.
- **FE (Vitest):** the pure mappers + money formatter; updated `gateway.test.ts` (still mock-by-default); capability-gating visibility; Settings four branches. Existing component branch tests stay green.
- **Live:** browser-verify wallet tab, activity tab, overview, wallet, activity, settings, and the deposit panel with a logged-in KYC-verified user (preview tooling; API on :3001, web on :3000, dev Postgres :5544 + Redis :6379).

## 8. Work order (phases for the plan)

1. **Contracts** — wallet/transaction/notification/profile DTOs (+ tests).
2. **Backend** — endpoints + repo reads + services, TDD unit→e2e, depcruise clean.
3. **FE mappers + money format** — pure, TDD.
4. **Gateway rewire + hooks** — real endpoints; events/search stay mock.
5. **Capability gating + Settings + deposit wiring** — visibility + real Settings.
6. **Env flip + live verification** — `.env.local`, browser sweep, screenshots.

## 9. Risks / notes

- **Valuation source coupling:** `WalletController` (presentation→application) must reach the rate provider only through the `quotes` application port, not the DB. Keep the valuation in an application service; `dependency-cruiser` must stay clean.
- **Empty wallets:** a fresh KYC-verified user has zero balances and no transactions → exercises the empty branch live; that's expected, not a failure.
- **Two reads of `/wallets/balances`** (via `getBalances` + `getWalletAssets`) — acceptable (15 s `staleTime`, deduped per query key); both map from the same endpoint.
- **Notifications feed semantics:** rows are outbox-oriented (WhatsApp/email). The in-app feed simply lists them; mapping `eventType`→presentation is FE-side and additive.
- **Timezone for grouping:** day-grouping uses the browser locale; acceptable for v1.
