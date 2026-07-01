# Transaction History — Flexible Ranges + Pagination Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Strict TDD: red → green → refactor, commit per task.

**Goal:** Let users query transaction history by flexible relative ranges (sub-day through ~1 year) and page through 20–1,000+ rows in both the chat card and the Activity page.

**Architecture:** Read-only. The model emits a named period, a relative `{amount,unit}` spec, or explicit from/to; the server (`resolveWindow`) computes every date (CLAUDE.md §3.1 holds). Pagination is keyset on `(createdAt desc, id desc)`; the chat card re-queries a frozen absolute window so relative ranges don't drift.

**Tech Stack:** NestJS 11, Prisma 7, Zod (`@handshake-agent/contracts`), Next 16 + TanStack Query, Jest (api), Vitest/RTL (web/contracts), Testcontainers.

## Global Constraints

- Shapes crossing FE/BE come from `@handshake-agent/contracts` (root §8). Pin zod `^3.25.32`.
- `application`/`domain`/`agent` never import `@prisma/client` or `infrastructure` (depcruise).
- No hardcoded tunables — page sizes/window/caps live in `StatementConfig` (root §7).
- Multi-currency: never hardcode NGN in labels/formatting; use the registry/config (root §13).
- Read-only: no engine, no proposal, no authorization. Verify with bare `eslint <files>` not `pnpm lint` (it `--fix`es). Gate: `pnpm typecheck && pnpm test && pnpm depcruise`.

---

### Task 1: Contract — relative-duration intent

**Files:**

- Modify: `packages/contracts/src/intents/query-transactions.intent.ts`
- Test: `packages/contracts/src/intents/query-transactions.intent.test.ts`

**Produces:** `RelativeDurationUnitSchema` (`'minute'|'hour'|'day'|'week'|'month'|'year'`); `QueryTransactionsIntentSchema` with optional `relativeAmount` (int 1..999) + `relativeUnit`, refined both-or-neither.

- [ ] Write failing tests: parses `{relativeAmount:2, relativeUnit:'week'}`; `{1,'hour'}`; `{24,'hour'}`; rejects `relativeAmount` without `relativeUnit`; rejects `relativeUnit` without `relativeAmount`; rejects `relativeAmount:0`; still a member of `IntentSchema`. Keep existing period/from-to tests green.
- [ ] Run: `pnpm --filter @handshake-agent/contracts test` → FAIL.
- [ ] Implement schema + `.superRefine` (both-or-neither). Export `RelativeDurationUnit` type.
- [ ] Run → PASS. Commit `feat(contracts): relative-duration spec on query_transactions intent`.

---

### Task 2: Contract — history pagination fields + query schema + cursor codec

**Files:**

- Modify: `packages/contracts/src/transactions/transaction-history.schema.ts`
- Test: `packages/contracts/src/transactions/transaction-history.schema.test.ts`

**Produces:**

- `TransactionHistoryResponseSchema` extended with `hasMore: boolean`, `nextCursor: string|null`, `txType: string`.
- `TransactionHistoryQuerySchema` = `{ period?, relativeAmount? (coerce int 1..999), relativeUnit?, from?, to?, txType?, cursor?, limit? (coerce int 1..100) }`. (`from`/`to` are plain strings — date-only OR full ISO; the server discriminates.)

- [ ] Write failing tests: response parses with the three new fields; rejects when missing; query schema coerces `limit`/`relativeAmount` from strings, defaults absent, rejects `limit:0` and `limit:101`.
- [ ] Run → FAIL. Implement. Run → PASS. Commit `feat(contracts): pagination fields + history query schema`.

---

### Task 3: Domain — cursor codec

**Files:**

- Create: `api/src/modules/transactions/domain/transaction-cursor.ts`
- Test: `api/src/modules/transactions/domain/transaction-cursor.spec.ts`

**Produces:** `encodeCursor(createdAt: Date, id: string): string` (base64url of `<iso>|<id>`); `decodeCursor(s: string): { createdAt: Date; id: string } | null` (null on malformed/invalid date).

- [ ] Write failing tests: round-trip encode→decode; `decodeCursor('garbage')` → null; `decodeCursor('')` → null; decode of base64url with bad date → null.
- [ ] Run: `pnpm --filter @handshake-agent/api test -- transaction-cursor` → FAIL.
- [ ] Implement (pure, no I/O). Run → PASS. Commit `feat(api): keyset cursor codec for transaction history`.

---

### Task 4: Domain — resolver relative units

**Files:**

- Modify: `api/src/modules/transactions/domain/statement-window.ts`
- Test: `api/src/modules/transactions/domain/statement-window.spec.ts`

**Consumes:** `RelativeDurationUnit` shape (string literals).
**Produces:** `QueryWindowSpec` with `relativeAmount?: number`, `relativeUnit?: 'minute'|'hour'|'day'|'week'|'month'|'year'`. Precedence: from/to → relative → period → default.

Implementation (insert a relative branch before the period switch; `now`/`local`/`utcFromLocal`/`startOfToday` already exist):

```ts
const REL_LABEL_UNIT: Record<string, string> = {
  minute: "minute",
  hour: "hour",
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};
if (spec.relativeAmount && spec.relativeUnit) {
  const n = spec.relativeAmount,
    u = spec.relativeUnit;
  if (u === "minute" || u === "hour") {
    const unitMs = u === "minute" ? 60_000 : 3_600_000;
    from = new Date(now.getTime() - n * unitMs);
    to = now;
  } else {
    if (u === "day") from = utcFromLocal(ly, lm, ld - n);
    else if (u === "week") from = utcFromLocal(ly, lm, ld - n * 7);
    else if (u === "month") from = utcFromLocal(ly, lm - n, ld);
    else /* year */ from = utcFromLocal(ly - n, lm, ld);
    to = now;
  }
  label =
    n === 1 ? `Past ${REL_LABEL_UNIT[u]}` : `Last ${n} ${REL_LABEL_UNIT[u]}s`;
  return clamp({ from, to, label }, now, maxMs);
}
```

- [ ] Write failing tests (now = `2026-06-29T10:00:00Z`, cfg `{maxWindowDays:400, timezoneOffsetMinutes:60}`):
  - `{relativeAmount:1, relativeUnit:'hour'}` → from `2026-06-29T09:00:00Z`, to=now, label "Past hour".
  - `{24,'hour'}` → from `2026-06-28T10:00:00Z`, label "Last 24 hours".
  - `{30,'minute'}` → from `2026-06-29T09:30:00Z`, label "Last 30 minutes".
  - `{2,'week'}` → from `2026-06-14T23:00:00Z` (00:00 WAT Jun 15), label "Last 2 weeks".
  - `{6,'month'}` → from `2025-12-31T23:00:00Z` (00:00 WAT Dec 29? compute: utcFromLocal(2026,0-... )`; assert label "Last 6 months" + from is local-midnight of Dec 29 2025).
  - `{1,'year'}` → label "Past year", from local-midnight Jun 29 2025.
  - precedence: spec with both from/to and relative → range wins; spec with relative and period → relative wins.
  - clamp: `{5,'year'}` → window ≈ 400 days, label "Last 5 years".
- [ ] Run → FAIL. Implement. Run → PASS. Commit `feat(api): resolve relative-duration history windows (sub-day + day+)`.

---

### Task 5: Config — StatementConfig page sizes + caps

**Files:**

- Modify: `api/src/core/config/configuration.ts` (`StatementConfig` interface + `statement` block)
- Test: `api/src/core/config/configuration.spec.ts` (if absent, assert via a small new spec)

**Produces:** `StatementConfig { linkTtlSeconds; maxWindowDays; defaultPageSize; maxPageSize; statementMaxRows; timezoneOffsetMinutes }`. Values: `maxWindowDays:400`, `defaultPageSize:10`, `maxPageSize:100`, `statementMaxRows:5000`. Remove `rowCap`.

- [ ] Write failing test asserting `config().statement` has the new fields with those values and no `rowCap`.
- [ ] Run → FAIL. Implement (update interface + defaults). Run → PASS. Commit `feat(config): paginated statement config (page size + caps)`.

---

### Task 6: Repository — keyset pagination + index

**Files:**

- Modify: `api/src/modules/transactions/application/ports/transaction.repository.port.ts`
- Modify: `api/src/modules/transactions/infrastructure/transaction.prisma.repository.ts`
- Modify: `api/prisma/schema/06-engine.prisma` (add index)
- Create: migration `api/prisma/migrations/<ts>_tx_userid_createdat_id_idx/migration.sql`
- Test: `api/src/modules/transactions/infrastructure/transaction.prisma.repository.spec.ts` (Testcontainers)

**Produces:** `listByUserInRange({ userId, from, to, types?, limit, cursor? }): Promise<{ rows, total, hasMore, nextCursor: string|null }>`.

Prisma keyset:

```ts
const cur = input.cursor ? decodeCursor(input.cursor) : null;
const where: Prisma.TransactionWhereInput = {
  userId: input.userId,
  createdAt: { gte: input.from, lte: input.to },
  ...(input.types?.length
    ? { type: { in: input.types as TransactionType[] } }
    : {}),
  ...(cur
    ? {
        OR: [
          { createdAt: { lt: cur.createdAt } },
          { createdAt: cur.createdAt, id: { lt: cur.id } },
        ],
      }
    : {}),
};
const [rows, total] = await this.prisma.$transaction([
  this.prisma.transaction.findMany({
    where,
    select: TRANSACTION_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
  }),
  this.prisma.transaction.count({
    where: /* window WITHOUT the cursor OR */ baseWhere,
  }),
]);
const hasMore = rows.length > input.limit;
const page = hasMore ? rows.slice(0, input.limit) : rows;
const last = page[page.length - 1];
const nextCursor =
  hasMore && last ? encodeCursor(last.createdAt, last.id) : null;
return { rows: page.map(toRecord), total, hasMore, nextCursor };
```

(Compute `total` against `baseWhere` = window+types **without** the cursor OR, so it's the full-window count, not the remaining count.)

Index (06-engine.prisma): `@@index([userId, createdAt(sort: Desc), id(sort: Desc)])`.

- [ ] Write failing integration tests: seed 5 rows (distinct createdAt) for a user → page size 2 returns newest 2 + `hasMore:true` + `nextCursor`; passing `nextCursor` returns next 2; last page `hasMore:false`, `nextCursor:null`; `total` stays 5 across pages; `types` filter narrows; rows for other users excluded. Tie-break: two rows same `createdAt`, different `id` → stable order, no dup/skip across pages.
- [ ] Run → FAIL. Add index to schema; create migration SQL (`CREATE INDEX ... ON transactions("userId","createdAt" DESC,"id" DESC);`). Implement repo. Run → PASS (Testcontainers applies migrations).
- [ ] Commit `feat(api): keyset pagination on transaction history repo + index`.

---

### Task 7: Application — history service pagination

**Files:**

- Modify: `api/src/modules/transactions/application/transaction-history.service.ts`
- Test: `api/src/modules/transactions/application/transaction-history.service.spec.ts`

**Consumes:** repo `listByUserInRange` (Task 6), `resolveWindow` (Task 4), `StatementConfig` (Task 5).
**Produces:**

- `query(userId, spec)` → first page (`pageSize = clamp(spec.limit ?? defaultPageSize, 1, maxPageSize)`), returns `TransactionHistoryResponse` incl. `hasMore`, `nextCursor`, `txType`.
- `queryPage({ userId, from: Date, to: Date, txType, cursor?, limit? })` → frozen window (no `resolveWindow`), returns same response shape (echo a `window` with a `from–to` label).
- `queryAllInRange({ userId, from, to, txType })` → loop `listByUserInRange` with `limit = maxPageSize`, follow `nextCursor` until exhausted or `items.length >= statementMaxRows`; returns `{ items, totalCount, truncated }`.
- `QueryTransactionsSpec` gains `relativeAmount?`, `relativeUnit?`, `limit?`.

- [ ] Write failing tests (mock repo): `query` passes resolved window + `limit:10` + no cursor, surfaces `hasMore`/`nextCursor`/`txType`; `query` with `spec.limit:50` clamps; `queryPage` does NOT call `resolveWindow` (passes given from/to), returns `hasMore`; `queryAllInRange` follows cursors across 3 pages and concatenates; `queryAllInRange` stops at `statementMaxRows` and sets `truncated`. Keep existing `query` tests (window label, downloadUrl) green by adding the new return fields.
- [ ] Run → FAIL. Implement. Run → PASS. Commit `feat(api): paginated + full-range history service`.

---

### Task 8: Agent prompt — relative-spec rules

**Files:**

- Modify: `api/src/modules/agent/infrastructure/anthropic-llm.provider.ts` (`buildSystemPrompt`)
- Test: `api/src/modules/agent/infrastructure/anthropic-llm.provider.spec.ts` (prompt-content assertions; if absent create)

**Produces:** updated rules 5/6: named period for common phrases; relative `{relativeAmount, relativeUnit}` for "last N <unit>" + sub-day ("an hour ago"→1 hour, "last 24 hours"→24 hour, "last 2 weeks"→2 week, "6 months"→6 month, "last year"→1 year); explicit from/to only for stated calendar dates; never compute dates.

- [ ] Write failing test: `buildSystemPrompt()` includes `relativeAmount`, `relativeUnit`, the unit list, and "never compute" guidance. Run → FAIL. Implement. Run → PASS. Commit `feat(agent): prompt describes relative-duration history spec`.

---

### Task 9: Presentation — endpoint + threading + PDF

**Files:**

- Modify: `api/src/modules/chat/presentation/transaction-history.controller.ts` (history GET + download)
- Modify: `api/src/modules/chat/application/web-chat.service.ts` (`query_transactions` case)
- Test: `api/src/modules/chat/presentation/transaction-history.controller.spec.ts` (create if absent) + extend `web-chat.service.spec.ts`

**Consumes:** `TransactionHistoryQuerySchema` (Task 2), service `query`/`queryPage`/`queryAllInRange` (Task 7).
**Produces:** `GET /transactions/history` validates via the shared schema; **`cursor` present ⇒ `queryPage`** (requires absolute ISO from/to), else `query`. Download controller uses `queryAllInRange`. `web-chat.service` passes `relativeAmount`/`relativeUnit` into `historyService.query`.

- [ ] Write failing tests: controller with `period` → calls `query`; with `cursor`+ISO `from`/`to` → calls `queryPage`; invalid `txType` → 400 (via schema). web-chat: a `query_transactions` intent with `relativeAmount:2,relativeUnit:'week'` forwards both to `historyService.query`. download: uses `queryAllInRange`.
- [ ] Run → FAIL. Implement (replace `PERIODS`/`TX_TYPES` Sets with schema parse). Run → PASS. Commit `feat(api): history endpoint + threading for ranges & pagination`.

---

### Task 10: Web — chat card "Show more"

**Files:**

- Modify: `web/lib/api/gateway.ts` (+ `Gateway` type), `web/lib/api/mock/index.ts`
- Create: `web/lib/api/mappers/history-row.ts` (shared row mapper extracted from `agent-outcome.ts`)
- Modify: `web/lib/chat/agent-outcome.ts` (use shared mapper), `web/lib/query/keys.ts`, `web/lib/query/hooks.ts`
- Modify: `web/components/chat/cards/transactions-card.tsx`, `web/types/components.ts`
- Test: `web/components/chat/cards/transactions-card.test.tsx`, `web/lib/api/mappers/*.test.ts`

**Consumes:** outcome `transactions` now carries `hasMore`/`nextCursor`/`txType`/`window`.
**Produces:** `gateway.getTransactionHistoryPage({from,to,txType,cursor})` → `GET /transactions/history` → `{rows, hasMore, nextCursor}` (rows mapped via `history-row`). `TransactionsCard` shows a "Show more" button when `hasMore`; on click appends the next page; loading/error states; PDF link unchanged.

- [ ] Write failing tests: card renders "Show more" when `hasMore`; clicking calls the hook and appends rows; hides when `!hasMore`; error state on failure. Run → FAIL. Implement. Run → PASS. Commit `feat(web): load-more on chat transactions card`.

---

### Task 11: Web — Activity infinite pagination + multi-currency

**Files:**

- Modify: `web/lib/query/hooks.ts` (`useInfiniteActivity`), `web/lib/api/gateway.ts` (raw `getActivityPage(cursor?)`), `web/lib/api/mock/index.ts`
- Modify: `web/lib/api/mappers/transactions.ts` (accept `fiatSymbols` from config; drop hardcoded NGN)
- Modify: `web/components/desktop/activity-page.tsx`, `web/components/mobile/activity-tab.tsx`
- Test: `web/components/desktop/activity-page.test.tsx`, `web/components/mobile/activity-tab.test.tsx`, `web/lib/api/mappers/transactions.test.ts`

**Produces:** `useInfiniteActivity()` over `GET /transactions` cursor; pages flattened then grouped; "Load more" button (loading/error/empty/data preserved). `mapTransactions(res, { now, fiatSymbols })` sources symbols from `/config`.

- [ ] Write failing tests: activity renders first page + "Load more"; clicking loads page 2 and appends groups; no button when `nextCursor` absent; mapper uses provided symbol (e.g. GHS "GH₵") not a hardcoded ₦. Run → FAIL. Implement. Run → PASS. Commit `feat(web): infinite pagination + config-sourced currency symbols on Activity`.

---

### Task 12: Full gate

- [ ] `pnpm --filter @handshake-agent/contracts test`, `pnpm --filter @handshake-agent/api test`, `pnpm --filter @handshake-agent/web test` all green.
- [ ] `pnpm --filter @handshake-agent/api test:e2e` (history endpoints) green.
- [ ] `pnpm typecheck` green; `pnpm depcruise` clean (agent/application still free of prisma).
- [ ] `git status` clean; final review of the diff.
