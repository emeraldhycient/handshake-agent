# Transaction history — flexible date ranges + pagination

Date: 2026-06-30
Branch: based on `feat/web-agent-vertical`
Status: approved (design)

## Problem

Two confirmed gaps in the transaction-history experience, diagnosed live:

- **GAP 1 — rigid ranges.** The `query_transactions` intent supports only a 7-value
  period enum (`today`…`all`) plus an explicit date-only `from`/`to`. Anything else
  ("last 2 weeks", "6 months", "last year", "an hour ago", "last 24 hours") cannot be
  expressed, so it falls back to `all` → "Last 365 days".
- **GAP 2 — no pagination.** The chat history query reads `limit: cfg.rowCap` (100), a
  hard cap with no cursor/offset and no "load more". The Activity page (`GET /transactions`)
  already returns a `nextCursor` but the UI fetches only page 1 and has no "Load more".
  Histories of 20–1,000+ rows are invisible past the first page.
- **GAP C — currency hardcoding.** The Activity mapper hardcodes `{ NGN: "₦" }`.

This is a **read-only** feature: the model proposes a query spec, the server computes the
window and reads own-data scoped by `userId`. No engine, no proposal, no authorization
(CLAUDE.md §3.1 still holds — the model never computes calendar dates; the server does).

## Decisions (confirmed)

1. Chat-card "load more" extends the existing `GET /transactions/history` endpoint with a
   **frozen absolute window** (`from`/`to` as full ISO) + keyset `cursor` + `limit`. When a
   cursor is present the server skips `resolveWindow` so a relative range like "today" does
   not drift between page loads.
2. The PDF statement becomes **true full-range**: it internally paginates the repo up to a
   configurable safety cap (`statementMaxRows`, default 5000) instead of the 100-row cap.
3. Default page size is **10**; hard max per page is **100**.
4. `maxWindowDays` is raised 365 → **400** (headroom so "last year" is not trimmed; still
   clamps absurd ranges like "last 5 years").

## GAP 1 — Flexible ranges (scalable, no ever-growing enum)

### Contract — `packages/contracts/src/intents/query-transactions.intent.ts`

Add a server-resolved relative-duration spec **alongside** the kept period enum + from/to:

```ts
export const RelativeDurationUnitSchema = z.enum([
  'minute', 'hour', 'day', 'week', 'month', 'year',
])
// added to QueryTransactionsIntentSchema:
relativeAmount: z.number().int().min(1).max(999).optional(),
relativeUnit: RelativeDurationUnitSchema.optional(),
```

Refinement: `relativeAmount` and `relativeUnit` are both-present or both-absent. The model
emits the spec (or a named period, or explicit from/to); the **server computes every date**.

Tests (vitest): "last 2 weeks"→{2,week}, "6 months"→{6,month}, "an hour ago"→{1,hour},
"last 24 hours"→{24,hour}, reject amount-without-unit, reject 0, still a member of the
`Intent` discriminated union.

### Resolver — `api/src/modules/transactions/domain/statement-window.ts`

Extend `QueryWindowSpec` with `relativeAmount?` + `relativeUnit?`. Precedence:
**explicit from/to (valid date-only range) → relative spec → named period → default.**

- **sub-day** (`minute`/`hour`): exact `from = now − amount·unitMs`, `to = now`. No day
  alignment — uses the real CLOCK `now`.
- **day+** (`day`/`week`/`month`/`year`): keep the WAT (UTC+1) midnight alignment.
  `day`→`utcFromLocal(ly, lm, ld − amount)`, `week`→`… ld − amount·7`,
  `month`→`utcFromLocal(ly, lm − amount, ld)` (calendar arithmetic),
  `year`→`utcFromLocal(ly − amount, lm, ld)`; `to = now`.
- **Labels** reflect the real range: amount 1 → "Past hour"/"Past day"/"Past year";
  amount > 1 → "Last 2 weeks"/"Last 6 months"/"Last 24 hours"/"Last 30 minutes".
- `clamp` still applies (guards over-long ranges). `maxWindowDays` → 400.

Tests (jest): sub-day exact offsets (1 hour, 24 hour, 30 min), day/week/month/year
day-aligned bounds, labels, precedence (from/to > relative > period), clamp of a huge
relative ("last 5 years" → 400 days).

### Prompt — `api/src/modules/agent/infrastructure/anthropic-llm.provider.ts`

Rewrite the query rules: named period for common phrases (today/this_week/this_month/…);
relative spec `{relativeAmount, relativeUnit}` for "last N units" and sub-day phrasings
("an hour ago"→{1,hour}, "last 24 hours"→{24,hour}, "last 2 weeks"→{2,week},
"6 months"→{6,month}, "last year"→{1,year}); explicit from/to only for stated calendar
dates; never compute dates. Tests assert the prompt mentions the relative spec + units.

### Threading

`api/src/modules/chat/application/web-chat.service.ts` (`case 'query_transactions'`) and the
HTTP controller pass `relativeAmount`/`relativeUnit` into the spec.
`QueryTransactionsSpec` (history service) gains the two fields.

## GAP 2 — Pagination (keyset on `(createdAt desc, id desc)`)

### Contract — `transaction-history.schema.ts`

`TransactionHistoryResponseSchema` gains:

- `hasMore: boolean`
- `nextCursor: z.string().nullable()` — opaque base64url `<createdAtISO>|<id>`
- `txType: z.string()` — the effective filter, so the card can re-query the same filter

Keep `totalCount` + `truncated`. Add `TransactionHistoryQuerySchema` for the endpoint:
`period?`, `relativeAmount?`, `relativeUnit?`, `from?`, `to?` (date-only **or** full ISO),
`txType?`, `cursor?`, `limit?` (coerced int 1..100). Add a small cursor codec
(`encodeCursor`/`decodeCursor`) in the transactions domain (server-internal; the FE treats
the cursor as opaque).

### Repository — port + Prisma impl

`listByUserInRange` signature → `{userId, from, to, types?, limit, cursor?}` returning
`{rows, total, hasMore, nextCursor}`:

- order by `createdAt desc, id desc`;
- keyset `WHERE (createdAt < c.ts) OR (createdAt = c.ts AND id < c.id)` AND range AND types
  AND userId;
- `take: limit + 1` to detect `hasMore`; `nextCursor` from the last row of the trimmed page;
- `total` = `count(window)` (one indexed COUNT; computed each call — cheap on the index).

Add Prisma index to `Transaction` (`api/prisma/schema/06-engine.prisma`):
`@@index([userId, createdAt(sort: Desc), id(sort: Desc)])` + a migration. (The existing
`[userId, status, createdAt]` leads with `status` and lacks `id` — it does not serve this
keyset.)

`findByUserId` (activity feed, keyset on `id`/uuid7) is left as-is; the activity surface
gets pagination at the UI layer using the already-returned `nextCursor`.

### History service — `transaction-history.service.ts`

- `query(spec)` → `resolveWindow` → first page (`defaultPageSize`) + `hasMore`/`nextCursor`
  - `totalCount` + `window` + `downloadUrl` + `txType`.
- `queryPage({userId, from, to, txType, cursor, limit})` → **frozen absolute** window (skips
  `resolveWindow` → no relative drift) → `{items, hasMore, nextCursor, totalCount, window}`.
- `queryAllInRange({userId, from, to, txType})` → loops the cursor up to `statementMaxRows`,
  returns `{items, totalCount, truncated}` for the **full-range PDF**.
- `queryResolved` keeps mapping rows→`TransactionHistoryItem` via the registry (multi-currency).

Page size resolves from config: `clamp(requested ?? defaultPageSize, 1, maxPageSize)`.

### Endpoint — `transaction-history.controller.ts` `GET /transactions/history`

Validate query via the shared `TransactionHistoryQuerySchema` (replaces the hand-rolled
`PERIODS`/`TX_TYPES` Sets). Discriminator: **`cursor` present ⇒ `queryPage` (frozen absolute
from/to ISO required)**, else `query` (spec). The download controller switches to
`queryAllInRange`.

### Config — `configuration.ts` `StatementConfig`

`rowCap` → `maxPageSize: 100`; add `defaultPageSize: 10`, `statementMaxRows: 5000`;
`maxWindowDays: 400`. Update all `cfg.rowCap` readers.

## GAP C — Multi-currency

Drop the hardcoded `FIAT_SYMBOLS = { NGN: "₦" }` in `web/lib/api/mappers/transactions.ts`;
source fiat symbols from the `/config` fiats (already fetched via `useConfig`). The chat-card
path already formats server-side via the registry.

## Web

The `transactions` outcome carries `hasMore`/`nextCursor`/`txType`/`window`.

- **Chat card** (`web/components/chat/cards/transactions-card.tsx`): a "Show more" control
  appears when `hasMore`. Local accumulated rows seeded from props; clicking fetches the next
  page via a new `useTransactionHistoryPage` hook → gateway `getTransactionHistoryPage(
{from, to, txType, cursor})` → a **shared row-mapper** (extracted from
  `agent-outcome.ts` so initial render and load-more map identically) → appends. Button has
  loading/error states. The PDF download link is unchanged.
- **Activity** (`web/components/desktop/activity-page.tsx` + `web/components/mobile/activity-tab.tsx`):
  switch `useActivity` → `useInfiniteActivity` (`useInfiniteQuery` over `GET /transactions`
  cursor). Flatten all loaded pages, group once, render a "Load more" button. Preserve the
  four async branches (loading/error/empty/data) and the category filters.

## Out of scope (Drift noted, not done here)

- Server-side formatting of the **Activity** amounts (`GET /transactions`) to fully unify the
  two surfaces' money formatting — larger refactor; GAP C is addressed via config-sourced
  symbols instead.

## Testing (strict TDD, per phase)

Contracts (vitest), resolver (jest), repo keyset (jest unit + Testcontainers integration),
history service (jest), agent prompt (jest), endpoints + threading (jest/e2e), web
(vitest/RTL). Gate: `pnpm typecheck && pnpm test` (api jest + contracts/web vitest) +
`pnpm depcruise` green. Read-only — no engine/authorization touched.
