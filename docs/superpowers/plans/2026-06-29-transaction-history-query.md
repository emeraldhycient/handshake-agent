# Transaction-History Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user ask the agent for their own transaction history (web + WhatsApp) and download a PDF statement, via a new read-only `query_transactions` intent that never moves money.

**Architecture:** The LangGraph agent emits a validated `query_transactions` intent (a read-only query spec — period enum + optional explicit dates + type filter). A deterministic domain resolver turns that into a concrete `[from,to]` window (WAT day boundaries). A read-only `TransactionHistoryService` reads the existing `Transaction`/`Receipt` tables scoped to the authenticated `userId`, formats amounts via `AssetRegistry`, and returns a structured response. Web renders a list card; WhatsApp renders a text list + a signed download link. A public, HMAC-signed-token endpoint streams a `pdfkit`-generated statement. The engine is never touched.

**Tech Stack:** NestJS 11 (clean-arch feature modules), Prisma 7, Zod (`@handshake-agent/contracts`), `pdfkit`, Next.js 16 + Zustand + Vitest, Jest + Testcontainers.

## Global Constraints

- **Model proposes, engine disposes (§3.1):** the intent is a read-only query spec; no `ProposalService`/`ExecutionService` call, no ledger mutation, ever.
- **Agent has no DB access (§3.2):** the only agent-layer change is one prompt block; `dependency-cruiser` must stay clean.
- **Read-only own data:** history exposes only the authenticated/linked user's rows. **Server-side `userId` scoping is the security boundary.** No KYC/PIN gate (those govern money-*moving* endpoints only, §3.3).
- **Contracts are the single source of truth (§8):** every cross-boundary shape comes from `@handshake-agent/contracts`. Pinned `zod ^3.25.76` (`z.string().date()` available).
- **No hardcoded tunables (§7):** statement TTL, max-window-days, row cap, WAT offset live in `configuration.ts` (JSON layer); `STATEMENT_SIGNING_KEY` and `PUBLIC_API_BASE_URL` live in env.
- **Amounts are decimal strings**, formatted only via `AssetRegistry.formatCrypto` / `formatFiat`. Never `Intl`, never manual currency strings.
- **Determinism:** no argless `new Date()` / `Date.now()` in domain/app code — use the injected `CLOCK`. (`new Date(isoString)` is allowed.)
- **TDD, red→green→refactor**, frequent commits. Conventional Commits (`feat(api): …`, `feat(web): …`, `feat(contracts): …`).
- **Run scoped:** `pnpm --filter @handshake-agent/api test`, `… test:e2e`, `pnpm --filter @handshake-agent/web test`. Do **not** run `pnpm lint` (it auto-fixes unrelated files); use `pnpm --filter @handshake-agent/api typecheck`.

---

## File Structure

**contracts (`packages/contracts/src/`)**
- `intents/query-transactions.intent.ts` (new) — the intent schema + types.
- `intents/index.ts` (modify) — add to the `action` union + re-export.
- `transactions/transaction-history.schema.ts` (new) — response item/window/response schemas.
- `transactions/index.ts` (new) — barrel.
- `index.ts` (modify) — add `export * from './transactions/index'`.
- `chat/chat.schemas.ts` (modify) — add the `transactions` member to `AgentTurnOutcome`.

**api (`api/src/`)**
- `core/config/configuration.ts` (modify) — `StatementConfig` + `statement` block.
- `core/config/env.schema.ts` (modify) — `STATEMENT_SIGNING_KEY`, `PUBLIC_API_BASE_URL`.
- `modules/transactions/domain/statement-window.ts` (new) — pure `resolveWindow`.
- `modules/transactions/domain/statement-window.spec.ts` (new) — resolver tests.
- `modules/transactions/application/statement-token.service.ts` (new) — sign/verify/buildDownloadUrl.
- `modules/transactions/application/statement-token.service.spec.ts` (new).
- `modules/transactions/application/statement-model.ts` (new) — pure `buildStatementModel`.
- `modules/transactions/application/statement-model.spec.ts` (new).
- `modules/transactions/application/ports/statement-generator.port.ts` (new) — `STATEMENT_GENERATOR` + interfaces.
- `modules/transactions/infrastructure/pdf-statement.generator.ts` (new) — pdfkit adapter.
- `modules/transactions/infrastructure/pdf-statement.generator.spec.ts` (new).
- `modules/transactions/application/ports/transaction.repository.port.ts` (modify) — add `listByUserInRange`.
- `modules/transactions/infrastructure/transaction.prisma.repository.ts` (modify) — impl.
- `modules/transactions/application/transaction-history.service.ts` (new) — the read service.
- `modules/transactions/application/transaction-history.service.spec.ts` (new).
- `modules/transactions/transactions.module.ts` (modify) — providers + exports.
- `modules/chat/presentation/transaction-history.controller.ts` (new) — JWT history + public download.
- `modules/chat/chat.module.ts` (modify) — controllers + `WEB_CHAT_HISTORY_SERVICE` binding.
- `modules/chat/application/web-chat.service.ts` (modify) — `query_transactions` case + injection.
- `modules/chat/application/web-chat.service.spec.ts` (modify) — new branch test.
- `modules/agent/infrastructure/anthropic-llm.provider.ts` (modify) — prompt block.
- `modules/agent/infrastructure/anthropic-llm.provider.spec.ts` (modify) — prompt assertion.
- `modules/conversations/application/conversation.service.ts` (modify) — `query_transactions` case + handler + injection.
- `modules/conversations/application/conversation.service.spec.ts` (modify) — handler test.
- `modules/conversations/conversations.module.ts` (modify) — `TRANSACTION_HISTORY_SERVICE` binding.
- `test/transaction-history.e2e-spec.ts` (new) — chat outcome + history endpoint + statement download.

**web (`web/`)**
- `lib/schemas/chat.ts` (modify) — `TransactionsView` + union member.
- `lib/store/chat-store.ts` (modify) — `transactions` outcome mapping.
- `types/components.ts` (modify) — `TransactionsCardProps`.
- `components/chat/cards/transactions-card.tsx` (new) — the card.
- `components/chat/cards/transactions-card.test.tsx` (new).
- `components/chat/chat-message.tsx` (modify) — `case "transactions"`.

---

## Task 1: Bootstrap — install workspace deps + add pdfkit

**Files:** none (environment only).

This worktree currently has **no `node_modules`**, and `pdfkit` is not a dependency. Establish a working test runner and the PDF lib before any test can run.

- [ ] **Step 1: Install the workspace** (from the worktree root)

```bash
cd /Users/dev_mechanic/Desktop/dev-projects/handshake-agent/.claude/worktrees/trusting-khorana-970635
pnpm install
```

- [ ] **Step 2: Add the PDF library to the api package**

```bash
pnpm --filter @handshake-agent/api add pdfkit
pnpm --filter @handshake-agent/api add -D @types/pdfkit
```

- [ ] **Step 3: Verify the api test runner works**

Run: `pnpm --filter @handshake-agent/api test -- --passWithNoTests`
Expected: Jest runs (existing suites pass), exits 0.

- [ ] **Step 4: Verify Prisma client is generated** (needed by infra + e2e)

Run: `pnpm --filter @handshake-agent/api exec prisma generate`
Expected: "Generated Prisma Client" into `api/generated/prisma`.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml api/package.json
git commit -m "chore(api): add pdfkit + @types/pdfkit for statement generation"
```

---

## Task 2: Contracts — `query_transactions` intent

**Files:**
- Create: `packages/contracts/src/intents/query-transactions.intent.ts`
- Modify: `packages/contracts/src/intents/index.ts`
- Test: `packages/contracts/src/intents/query-transactions.intent.test.ts`

**Interfaces:**
- Produces: `QueryTransactionsIntentSchema`, `QueryTransactionsIntent`, `TransactionPeriodSchema`, `TransactionTypeFilterSchema`; the `IntentSchema` discriminated union now includes `action:'query_transactions'`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/intents/query-transactions.intent.test.ts
import { describe, it, expect } from 'vitest'
import { IntentSchema } from './index'
import { QueryTransactionsIntentSchema } from './query-transactions.intent'

describe('QueryTransactionsIntent', () => {
  it('parses a period-only query and defaults download=false', () => {
    const parsed = QueryTransactionsIntentSchema.parse({
      action: 'query_transactions',
      period: 'last_week',
    })
    expect(parsed).toEqual({ action: 'query_transactions', period: 'last_week', download: false })
  })

  it('parses an explicit date range with a type filter and download', () => {
    const parsed = QueryTransactionsIntentSchema.parse({
      action: 'query_transactions',
      from: '2026-06-01',
      to: '2026-06-15',
      txType: 'send',
      download: true,
    })
    expect(parsed.from).toBe('2026-06-01')
    expect(parsed.txType).toBe('send')
    expect(parsed.download).toBe(true)
  })

  it('rejects a malformed date', () => {
    const r = QueryTransactionsIntentSchema.safeParse({ action: 'query_transactions', from: '06/01/2026' })
    expect(r.success).toBe(false)
  })

  it('is a member of the Intent discriminated union', () => {
    const r = IntentSchema.safeParse({ action: 'query_transactions', period: 'today' })
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @handshake-agent/contracts test -- query-transactions`
Expected: FAIL — `Cannot find module './query-transactions.intent'`.
(If the contracts package has no `test` script/vitest, run these via the web vitest alias instead: `pnpm --filter @handshake-agent/web test -- query-transactions` — the contracts source is aliased in `web/vitest.config.ts`. Use whichever resolves.)

- [ ] **Step 3: Create the intent schema**

```ts
// packages/contracts/src/intents/query-transactions.intent.ts
import { z } from 'zod'

// Relative-period enum. The model picks one of these for phrases like "today" /
// "last week"; it never computes calendar dates itself (that is the server's job).
export const TransactionPeriodSchema = z.enum([
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'all',
])
export type TransactionPeriod = z.infer<typeof TransactionPeriodSchema>

// User-facing direction filter. 'receive' maps to the engine's `deposit` type
// server-side; 'all'/omitted means every money-moving type.
export const TransactionTypeFilterSchema = z.enum(['buy', 'sell', 'send', 'receive', 'all'])
export type TransactionTypeFilter = z.infer<typeof TransactionTypeFilterSchema>

// Read-only query spec emitted by the NLU layer. It is NOT a transaction: there
// is no amount, destination, or authorization — the engine is never involved.
export const QueryTransactionsIntentSchema = z.object({
  action: z.literal('query_transactions'),
  period: TransactionPeriodSchema.optional(),
  // ISO YYYY-MM-DD — emitted ONLY for an explicit calendar range stated by the user.
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  txType: TransactionTypeFilterSchema.optional(),
  // true only when the user asks for a file/statement/PDF.
  download: z.boolean().optional().default(false),
})
export type QueryTransactionsIntent = z.infer<typeof QueryTransactionsIntentSchema>
```

- [ ] **Step 4: Add it to the union + re-export**

In `packages/contracts/src/intents/index.ts`: add the import after the other intent imports, the member to the `z.discriminatedUnion('action', [...])` array (before `NoIntentSchema`), and the re-export.

```ts
import { QueryTransactionsIntentSchema } from './query-transactions.intent'
// ...inside z.discriminatedUnion('action', [ ... , CheckBalanceIntentSchema, QueryTransactionsIntentSchema, NoIntentSchema ])
export * from './query-transactions.intent'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @handshake-agent/contracts test -- query-transactions` (or the web alias variant)
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/intents/
git commit -m "feat(contracts): add query_transactions intent (read-only history query spec)"
```

---

## Task 3: Contracts — transaction-history response + `transactions` outcome

**Files:**
- Create: `packages/contracts/src/transactions/transaction-history.schema.ts`
- Create: `packages/contracts/src/transactions/index.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/chat/chat.schemas.ts`
- Test: `packages/contracts/src/transactions/transaction-history.schema.test.ts`

**Interfaces:**
- Produces: `TransactionHistoryItemSchema`/`TransactionHistoryItem`, `TransactionWindowSchema`/`TransactionWindow`, `TransactionHistoryResponseSchema`/`TransactionHistoryResponse`; `AgentTurnOutcome` now has a `{ kind:'transactions', window, items, totalCount, truncated, downloadUrl }` member.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/transactions/transaction-history.schema.test.ts
import { describe, it, expect } from 'vitest'
import { TransactionHistoryResponseSchema } from './transaction-history.schema'
import { AgentTurnOutcomeSchema } from '../chat/chat.schemas'

const sample = {
  window: { from: '2026-06-01T00:00:00.000Z', to: '2026-06-29T00:00:00.000Z', label: 'This month' },
  items: [
    { id: 't1', type: 'buy', status: 'completed', direction: 'in',
      asset: 'USDT', cryptoAmount: '29.97 USDT', fiatAmount: '₦50,000.00', fiatCurrency: 'NGN',
      createdAt: '2026-06-10T10:00:00.000Z', receiptNumber: 'HS-2026-000001' },
  ],
  totalCount: 1,
  truncated: false,
  downloadUrl: 'http://localhost:3001/transactions/statement/download?token=abc.def',
}

describe('TransactionHistoryResponse', () => {
  it('parses a valid response', () => {
    expect(TransactionHistoryResponseSchema.parse(sample)).toEqual(sample)
  })
  it('is a valid transactions AgentTurnOutcome member', () => {
    const r = AgentTurnOutcomeSchema.safeParse({ kind: 'transactions', ...sample })
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @handshake-agent/contracts test -- transaction-history` (or web alias)
Expected: FAIL — module not found.

- [ ] **Step 3: Create the response schema + barrel**

```ts
// packages/contracts/src/transactions/transaction-history.schema.ts
import { z } from 'zod'

// One transaction row, ready for display. Amounts are already formatted display
// strings (via the server's AssetRegistry) — the FE never re-formats money.
export const TransactionHistoryItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  direction: z.enum(['in', 'out']),
  asset: z.string().optional(),
  cryptoAmount: z.string().optional(),
  fiatAmount: z.string().optional(),
  fiatCurrency: z.string().optional(),
  createdAt: z.string(), // ISO 8601
  receiptNumber: z.string().optional(),
})
export type TransactionHistoryItem = z.infer<typeof TransactionHistoryItemSchema>

export const TransactionWindowSchema = z.object({
  from: z.string(), // ISO 8601
  to: z.string(),
  label: z.string(), // human window description, e.g. "This month", "Jun 1 – 15, 2026"
})
export type TransactionWindow = z.infer<typeof TransactionWindowSchema>

export const TransactionHistoryResponseSchema = z.object({
  window: TransactionWindowSchema,
  items: z.array(TransactionHistoryItemSchema),
  totalCount: z.number().int().nonnegative(), // exact count in the window
  truncated: z.boolean(), // true when totalCount > items.length (row cap hit)
  downloadUrl: z.string(), // absolute, signed-token PDF download URL
})
export type TransactionHistoryResponse = z.infer<typeof TransactionHistoryResponseSchema>
```

```ts
// packages/contracts/src/transactions/index.ts
export * from './transaction-history.schema'
```

Add to `packages/contracts/src/index.ts` (after the `./chat/index` line):

```ts
export * from './transactions/index'
```

- [ ] **Step 4: Add the `transactions` member to `AgentTurnOutcome`**

In `packages/contracts/src/chat/chat.schemas.ts`, add the import at the top with the other tool imports:

```ts
import { TransactionHistoryResponseSchema } from '../transactions/transaction-history.schema'
```

and add this member to the `z.discriminatedUnion('kind', [ ... ])` array (after the `not_supported` member):

```ts
  TransactionHistoryResponseSchema.extend({ kind: z.literal('transactions') }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @handshake-agent/contracts test -- transaction-history` (or web alias)
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/
git commit -m "feat(contracts): add transaction-history response + transactions chat outcome"
```

---

## Task 4: Config — statement settings + env keys

**Files:**
- Modify: `api/src/core/config/configuration.ts`
- Modify: `api/src/core/config/env.schema.ts`
- Test: `api/src/core/config/configuration.spec.ts` (create if absent; else extend)

**Interfaces:**
- Produces: `AppConfig.statement: StatementConfig` (`linkTtlSeconds`, `maxWindowDays`, `rowCap`, `timezoneOffsetMinutes`); env `STATEMENT_SIGNING_KEY` (optional, default `''`) and `PUBLIC_API_BASE_URL` (optional URL).

- [ ] **Step 1: Write the failing test**

```ts
// api/src/core/config/configuration.spec.ts
import configuration from './configuration'

describe('configuration — statement', () => {
  it('exposes statement defaults', () => {
    const cfg = configuration()
    expect(cfg.statement).toEqual({
      linkTtlSeconds: 900,
      maxWindowDays: 365,
      rowCap: 100,
      timezoneOffsetMinutes: 60,
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- configuration`
Expected: FAIL — `cfg.statement` is undefined.

- [ ] **Step 3: Add `StatementConfig` + the `statement` block**

In `api/src/core/config/configuration.ts`, add the interface (near the other config interfaces):

```ts
/**
 * Statement / transaction-history configuration (CLAUDE.md §7).
 * All values are admin-tunable later via the DB-admin AppSetting layer.
 */
export interface StatementConfig {
  /** TTL (seconds) for a signed statement download link. Default 900 (15 min). */
  linkTtlSeconds: number
  /** Max history window in days; longer requests are clamped. Default 365. */
  maxWindowDays: number
  /** Max rows returned to the chat card / statement. Default 100 (truncation surfaced). */
  rowCap: number
  /** Fixed offset (minutes) for local day boundaries. WAT = UTC+1, no DST → 60. */
  timezoneOffsetMinutes: number
}
```

Add `statement: StatementConfig` to the `AppConfig` interface, and the block to the returned object:

```ts
  statement: {
    linkTtlSeconds: 900,
    maxWindowDays: 365,
    rowCap: 100,
    timezoneOffsetMinutes: 60,
  },
```

- [ ] **Step 4: Add the env keys**

In `api/src/core/config/env.schema.ts`, inside `envSchema`, add (next to `RECEIPT_SIGNING_KEY`):

```ts
  // HMAC-SHA256 key for signing statement download links. Empty is tolerated at
  // boot but StatementTokenService.sign() throws StatementNotSignableError and the
  // public download endpoint returns 503 (fail-closed — no unsigned link is issued).
  STATEMENT_SIGNING_KEY: z.string().optional().default(''),
  // Public base URL of THIS api (used to build absolute statement download links
  // for both web and WhatsApp). Coerce '' → undefined; when unset the token
  // service falls back to `http://localhost:${PORT}` (dev only).
  PUBLIC_API_BASE_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().optional(),
  ),
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @handshake-agent/api test -- configuration`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/core/config/
git commit -m "feat(api): add statement config block + STATEMENT_SIGNING_KEY/PUBLIC_API_BASE_URL env"
```

---

## Task 5: Domain — `resolveWindow` (pure date resolver)

**Files:**
- Create: `api/src/modules/transactions/domain/statement-window.ts`
- Test: `api/src/modules/transactions/domain/statement-window.spec.ts`

**Interfaces:**
- Produces: `resolveWindow(spec: QueryWindowSpec, now: Date, cfg: WindowConfig): StatementWindow` where `StatementWindow = { from: Date; to: Date; label: string }`, `QueryWindowSpec = { period?; from?; to? }`, `WindowConfig = { maxWindowDays; timezoneOffsetMinutes }`.

- [ ] **Step 1: Write the failing test**

```ts
// api/src/modules/transactions/domain/statement-window.spec.ts
import { resolveWindow } from './statement-window';

const cfg = { maxWindowDays: 365, timezoneOffsetMinutes: 60 }; // WAT

describe('resolveWindow (WAT day boundaries)', () => {
  // 2026-06-29T10:00:00Z = 11:00 WAT on Jun 29
  const now = new Date('2026-06-29T10:00:00.000Z');

  it('today = local midnight WAT → now', () => {
    const w = resolveWindow({ period: 'today' }, now, cfg);
    expect(w.from.toISOString()).toBe('2026-06-28T23:00:00.000Z'); // 00:00 WAT Jun 29
    expect(w.to.toISOString()).toBe(now.toISOString());
    expect(w.label).toBe('Today');
  });

  it('today is correct just after WAT midnight (UTC still previous day)', () => {
    // 2026-06-29T00:30:00Z = 01:30 WAT Jun 29 → "today" starts at 00:00 WAT Jun 29
    const justAfter = new Date('2026-06-29T00:30:00.000Z');
    const w = resolveWindow({ period: 'today' }, justAfter, cfg);
    expect(w.from.toISOString()).toBe('2026-06-28T23:00:00.000Z');
  });

  it('yesterday = full previous local day', () => {
    const w = resolveWindow({ period: 'yesterday' }, now, cfg);
    expect(w.from.toISOString()).toBe('2026-06-27T23:00:00.000Z'); // 00:00 WAT Jun 28
    expect(w.to.toISOString()).toBe('2026-06-28T22:59:59.999Z');   // 23:59:59.999 WAT Jun 28
    expect(w.label).toBe('Yesterday');
  });

  it('this_week = Monday 00:00 WAT → now (Jun 29 2026 is a Monday)', () => {
    const w = resolveWindow({ period: 'this_week' }, now, cfg);
    expect(w.from.toISOString()).toBe('2026-06-28T23:00:00.000Z'); // Mon Jun 29 00:00 WAT
    expect(w.label).toBe('This week');
  });

  it('last_month = full previous calendar month', () => {
    const w = resolveWindow({ period: 'last_month' }, now, cfg);
    expect(w.from.toISOString()).toBe('2026-04-30T23:00:00.000Z'); // 00:00 WAT May 1
    expect(w.to.toISOString()).toBe('2026-05-31T22:59:59.999Z');   // 23:59:59.999 WAT May 31
    expect(w.label).toBe('Last month');
  });

  it('explicit range uses start-of-from-day to end-of-to-day (WAT)', () => {
    const w = resolveWindow({ from: '2026-06-01', to: '2026-06-15' }, now, cfg);
    expect(w.from.toISOString()).toBe('2026-05-31T23:00:00.000Z'); // 00:00 WAT Jun 1
    expect(w.to.toISOString()).toBe('2026-06-15T22:59:59.999Z');   // 23:59:59.999 WAT Jun 15
    expect(w.label).toBe('Jun 1 – Jun 15, 2026');
  });

  it('clamps a future `to` to now', () => {
    const w = resolveWindow({ from: '2026-06-01', to: '2030-01-01' }, now, cfg);
    expect(w.to.toISOString()).toBe(now.toISOString());
  });

  it('clamps an over-long window to maxWindowDays', () => {
    const w = resolveWindow({ period: 'all' }, now, cfg);
    const days = (w.to.getTime() - w.from.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(365);
    expect(w.label).toBe('Last 365 days');
  });

  it('falls back to default (all) when from > to', () => {
    const w = resolveWindow({ from: '2026-06-15', to: '2026-06-01' }, now, cfg);
    expect(w.label).toBe('Last 365 days');
  });

  it('defaults to all when nothing is provided', () => {
    const w = resolveWindow({}, now, cfg);
    expect(w.label).toBe('Last 365 days');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- statement-window`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

```ts
// api/src/modules/transactions/domain/statement-window.ts
/**
 * Pure, deterministic resolver from a query spec to a concrete [from, to] window.
 * Day boundaries are computed in a FIXED-offset local zone (WAT = UTC+1, no DST)
 * so "today"/"this week" mean the user's calendar day, not a UTC day. No I/O,
 * no Date.now() — the caller passes `now` (from CLOCK) so tests are deterministic.
 */

export interface QueryWindowSpec {
  period?:
    | 'today'
    | 'yesterday'
    | 'this_week'
    | 'last_week'
    | 'this_month'
    | 'last_month'
    | 'all';
  from?: string; // ISO YYYY-MM-DD
  to?: string;
}

export interface WindowConfig {
  maxWindowDays: number;
  timezoneOffsetMinutes: number;
}

export interface StatementWindow {
  from: Date;
  to: Date;
  label: string;
}

const DAY_MS = 86_400_000;
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function resolveWindow(
  spec: QueryWindowSpec,
  now: Date,
  cfg: WindowConfig,
): StatementWindow {
  const offsetMs = cfg.timezoneOffsetMinutes * 60_000;
  const maxMs = cfg.maxWindowDays * DAY_MS;

  // A "local" Date whose UTC getters read as WAT wall-clock values.
  const local = (d: Date): Date => new Date(d.getTime() + offsetMs);
  // Build the real UTC instant for given local wall-clock parts.
  const utcFromLocal = (
    y: number, m: number, d: number,
    h = 0, mi = 0, s = 0, ms = 0,
  ): Date => new Date(Date.UTC(y, m, d, h, mi, s, ms) - offsetMs);

  const ln = local(now);
  const ly = ln.getUTCFullYear();
  const lm = ln.getUTCMonth();
  const ld = ln.getUTCDate();

  const startOfToday = utcFromLocal(ly, lm, ld);
  const endOfDay = (start: Date): Date => new Date(start.getTime() + DAY_MS - 1);

  let from: Date;
  let to: Date;
  let label: string;

  // ── 1. Explicit calendar range takes precedence ──────────────────────────
  const validRange =
    spec.from && spec.to && ISO_DATE.test(spec.from) && ISO_DATE.test(spec.to);
  if (validRange) {
    const [fy, fm, fd] = spec.from!.split('-').map(Number);
    const [ty, tm, td] = spec.to!.split('-').map(Number);
    const f = utcFromLocal(fy, fm - 1, fd);
    const t = endOfDay(utcFromLocal(ty, tm - 1, td));
    if (f.getTime() <= t.getTime()) {
      from = f;
      to = t;
      const lf = local(f);
      const lt = local(t);
      label = `${MONTHS[lf.getUTCMonth()]} ${lf.getUTCDate()} – ${MONTHS[lt.getUTCMonth()]} ${lt.getUTCDate()}, ${lt.getUTCFullYear()}`;
      return clamp({ from, to, label }, now, maxMs);
    }
    // from > to → fall through to default.
  }

  // ── 2. Period enum ───────────────────────────────────────────────────────
  switch (spec.period) {
    case 'today':
      from = startOfToday;
      to = now;
      label = 'Today';
      break;
    case 'yesterday': {
      const startYesterday = utcFromLocal(ly, lm, ld - 1);
      from = startYesterday;
      to = endOfDay(startYesterday);
      label = 'Yesterday';
      break;
    }
    case 'this_week': {
      const dow = local(startOfToday).getUTCDay(); // 0=Sun..6=Sat
      const sinceMonday = (dow + 6) % 7;
      from = utcFromLocal(ly, lm, ld - sinceMonday);
      to = now;
      label = 'This week';
      break;
    }
    case 'last_week': {
      const dow = local(startOfToday).getUTCDay();
      const sinceMonday = (dow + 6) % 7;
      const startThisWeek = utcFromLocal(ly, lm, ld - sinceMonday);
      from = new Date(startThisWeek.getTime() - 7 * DAY_MS);
      to = new Date(startThisWeek.getTime() - 1);
      label = 'Last week';
      break;
    }
    case 'this_month':
      from = utcFromLocal(ly, lm, 1);
      to = now;
      label = 'This month';
      break;
    case 'last_month': {
      const py = lm === 0 ? ly - 1 : ly;
      const pm = lm === 0 ? 11 : lm - 1;
      from = utcFromLocal(py, pm, 1);
      to = new Date(utcFromLocal(ly, lm, 1).getTime() - 1);
      label = 'Last month';
      break;
    }
    case 'all':
    default:
      from = new Date(now.getTime() - maxMs);
      to = now;
      label = `Last ${cfg.maxWindowDays} days`;
      break;
  }

  return clamp({ from, to, label }, now, maxMs);
}

function clamp(w: StatementWindow, now: Date, maxMs: number): StatementWindow {
  let { from, to } = w;
  if (to.getTime() > now.getTime()) to = now;
  if (to.getTime() - from.getTime() > maxMs) from = new Date(to.getTime() - maxMs);
  if (from.getTime() > to.getTime()) from = to;
  return { from, to, label: w.label };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @handshake-agent/api test -- statement-window`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/transactions/domain/statement-window.ts api/src/modules/transactions/domain/statement-window.spec.ts
git commit -m "feat(api): pure WAT-anchored transaction-history window resolver"
```

---

## Task 6: Application — `StatementTokenService`

**Files:**
- Create: `api/src/modules/transactions/application/statement-token.service.ts`
- Test: `api/src/modules/transactions/application/statement-token.service.spec.ts`

**Interfaces:**
- Consumes: `ConfigService<Env, true>` (reads `STATEMENT_SIGNING_KEY`, `PUBLIC_API_BASE_URL`, `PORT`, `statement.linkTtlSeconds`), `CLOCK`.
- Produces: `StatementTokenService.sign(payload): string`, `verify(token): StatementTokenPayload` (throws `StatementTokenInvalidError`), `buildDownloadUrl(token): string`; `StatementTokenPayload = { userId; from; to; txType }`. Throws `StatementNotSignableError` when the key is empty.

- [ ] **Step 1: Write the failing test**

```ts
// api/src/modules/transactions/application/statement-token.service.spec.ts
import { ConfigService } from '@nestjs/config';
import {
  StatementTokenService,
  StatementTokenInvalidError,
  StatementNotSignableError,
} from './statement-token.service';

function makeService(opts: { key?: string; base?: string; now: Date; ttl?: number }) {
  const map: Record<string, unknown> = {
    STATEMENT_SIGNING_KEY: opts.key ?? 'k'.repeat(32),
    PUBLIC_API_BASE_URL: opts.base ?? 'https://api.example.com',
    PORT: 3001,
    statement: { linkTtlSeconds: opts.ttl ?? 900, maxWindowDays: 365, rowCap: 100, timezoneOffsetMinutes: 60 },
  };
  const config = { get: (k: string) => map[k] } as unknown as ConfigService;
  const clock = { now: () => opts.now };
  return new StatementTokenService(config, clock);
}

const payload = { userId: 'u1', from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z', txType: 'all' };

describe('StatementTokenService', () => {
  const now = new Date('2026-06-29T10:00:00.000Z');

  it('signs and verifies a round-trip', () => {
    const svc = makeService({ now });
    const token = svc.sign(payload);
    expect(svc.verify(token)).toEqual(payload);
  });

  it('builds an absolute download URL', () => {
    const svc = makeService({ now });
    const token = svc.sign(payload);
    expect(svc.buildDownloadUrl(token)).toBe(
      `https://api.example.com/transactions/statement/download?token=${token}`,
    );
  });

  it('rejects a tampered token', () => {
    const svc = makeService({ now });
    const token = svc.sign(payload);
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(() => svc.verify(tampered)).toThrow(StatementTokenInvalidError);
  });

  it('rejects an expired token', () => {
    const signer = makeService({ now, ttl: 60 });
    const token = signer.sign(payload);
    const later = makeService({ now: new Date(now.getTime() + 120_000) });
    expect(() => later.verify(token)).toThrow(StatementTokenInvalidError);
  });

  it('throws when the signing key is empty (fail-closed)', () => {
    const svc = makeService({ now, key: '' });
    expect(() => svc.sign(payload)).toThrow(StatementNotSignableError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- statement-token`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the token service**

```ts
// api/src/modules/transactions/application/statement-token.service.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CLOCK, type Clock } from '../../../core/common/clock';
import type { Env } from '../../../core/config/env.schema';

/** Thrown when STATEMENT_SIGNING_KEY is unset — no link is ever issued unsigned. */
export class StatementNotSignableError extends Error {
  constructor() {
    super('STATEMENT_SIGNING_KEY is not configured — cannot sign statement links');
    this.name = 'StatementNotSignableError';
  }
}

/** Thrown for any malformed / tampered / expired token. */
export class StatementTokenInvalidError extends Error {
  constructor(reason: string) {
    super(`Statement token invalid: ${reason}`);
    this.name = 'StatementTokenInvalidError';
  }
}

export interface StatementTokenPayload {
  userId: string;
  from: string; // ISO 8601
  to: string;
  txType: string; // 'buy' | 'sell' | 'send' | 'receive' | 'all'
}

interface SignedPayload extends StatementTokenPayload {
  exp: number; // unix seconds
}

@Injectable()
export class StatementTokenService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  sign(payload: StatementTokenPayload): string {
    const key = this.requireKey();
    const ttl = this.config.get('statement', { infer: true })!.linkTtlSeconds;
    const exp = Math.floor(this.clock.now().getTime() / 1000) + ttl;
    const body = Buffer.from(
      JSON.stringify({ ...payload, exp } satisfies SignedPayload),
    ).toString('base64url');
    return `${body}.${this.mac(body, key)}`;
  }

  verify(token: string): StatementTokenPayload {
    const key = this.requireKey();
    const dot = token.indexOf('.');
    if (dot <= 0) throw new StatementTokenInvalidError('malformed');
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = this.mac(body, key);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new StatementTokenInvalidError('bad signature');
    }
    let parsed: SignedPayload;
    try {
      parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedPayload;
    } catch {
      throw new StatementTokenInvalidError('unparseable');
    }
    if (parsed.exp * 1000 <= this.clock.now().getTime()) {
      throw new StatementTokenInvalidError('expired');
    }
    return { userId: parsed.userId, from: parsed.from, to: parsed.to, txType: parsed.txType };
  }

  buildDownloadUrl(token: string): string {
    const base =
      this.config.get('PUBLIC_API_BASE_URL', { infer: true }) ??
      `http://localhost:${this.config.get('PORT', { infer: true })}`;
    return `${base}/transactions/statement/download?token=${token}`;
  }

  private requireKey(): string {
    const key = this.config.get('STATEMENT_SIGNING_KEY', { infer: true }) ?? '';
    if (!key) throw new StatementNotSignableError();
    return key;
  }

  private mac(body: string, key: string): string {
    return createHmac('sha256', key).update(body).digest('hex');
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @handshake-agent/api test -- statement-token`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/transactions/application/statement-token.service.ts api/src/modules/transactions/application/statement-token.service.spec.ts
git commit -m "feat(api): HMAC-signed statement download token service (fail-closed)"
```

---

## Task 7: Application — statement model + generator port

**Files:**
- Create: `api/src/modules/transactions/application/ports/statement-generator.port.ts`
- Create: `api/src/modules/transactions/application/statement-model.ts`
- Test: `api/src/modules/transactions/application/statement-model.spec.ts`

**Interfaces:**
- Produces: `STATEMENT_GENERATOR` token; `IStatementGenerator.generate(model: StatementModel): Promise<StatementFile>`; `StatementModel`, `StatementRow`, `StatementFile`; pure `buildStatementModel(input): StatementModel`.
- Consumes: `TransactionHistoryItem` (from contracts).

- [ ] **Step 1: Write the failing test**

```ts
// api/src/modules/transactions/application/statement-model.spec.ts
import { buildStatementModel } from './statement-model';
import type { TransactionHistoryItem } from '@handshake-agent/contracts';

const items: TransactionHistoryItem[] = [
  { id: 't1', type: 'buy', status: 'completed', direction: 'in',
    asset: 'USDT', cryptoAmount: '29.97 USDT', fiatAmount: '₦50,000.00', fiatCurrency: 'NGN',
    createdAt: '2026-06-10T10:00:00.000Z', receiptNumber: 'HS-2026-000001' },
  { id: 't2', type: 'send', status: 'settling', direction: 'out',
    asset: 'USDT', cryptoAmount: '10 USDT', createdAt: '2026-06-12T09:00:00.000Z' },
];

describe('buildStatementModel', () => {
  it('maps items to rows with signed amounts and a header', () => {
    const model = buildStatementModel({
      items, totalCount: 2, truncated: false,
      windowLabel: 'This month', accountLabel: 'u***@test.com',
      generatedAt: '2026-06-29T10:00:00.000Z', filename: 'handshake-statement.pdf',
    });
    expect(model.title).toBe('Transaction Statement');
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0]).toMatchObject({ type: 'buy', status: 'completed', amount: '+29.97 USDT', reference: 'HS-2026-000001' });
    expect(model.rows[1]).toMatchObject({ type: 'send', amount: '-10 USDT', reference: 't2' });
    expect(model.truncated).toBe(false);
    expect(model.totalCount).toBe(2);
  });

  it('uses fiat amount when crypto is absent', () => {
    const sell: TransactionHistoryItem = {
      id: 't3', type: 'sell', status: 'completed', direction: 'out',
      fiatAmount: '₦40,000.00', fiatCurrency: 'NGN', createdAt: '2026-06-13T09:00:00.000Z',
    };
    const model = buildStatementModel({
      items: [sell], totalCount: 1, truncated: false, windowLabel: 'X',
      accountLabel: 'a', generatedAt: '2026-06-29T10:00:00.000Z', filename: 'f.pdf',
    });
    expect(model.rows[0].amount).toBe('-₦40,000.00');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- statement-model`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the port**

```ts
// api/src/modules/transactions/application/ports/statement-generator.port.ts
/** DI token for the statement (PDF) generator. Infra provides the adapter. */
export const STATEMENT_GENERATOR = Symbol('STATEMENT_GENERATOR');

export interface StatementRow {
  date: string; // ISO 8601
  type: string;
  status: string;
  direction: 'in' | 'out';
  amount: string; // signed, formatted display string, e.g. '+29.97 USDT'
  reference: string; // receiptNumber when present, else the tx id
}

export interface StatementModel {
  title: string;
  accountLabel: string;
  windowLabel: string;
  generatedAt: string; // ISO 8601 (drives the deterministic PDF CreationDate)
  rows: StatementRow[];
  totalCount: number;
  truncated: boolean;
  filename: string;
}

export interface StatementFile {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

export interface IStatementGenerator {
  generate(model: StatementModel): Promise<StatementFile>;
}
```

- [ ] **Step 4: Implement the pure model builder**

```ts
// api/src/modules/transactions/application/statement-model.ts
import type { TransactionHistoryItem } from '@handshake-agent/contracts';
import type { StatementModel, StatementRow } from './ports/statement-generator.port';

export interface BuildStatementModelInput {
  items: TransactionHistoryItem[];
  totalCount: number;
  truncated: boolean;
  windowLabel: string;
  accountLabel: string;
  generatedAt: string;
  filename: string;
}

/** Pure: shape history items into a printable statement model. No I/O. */
export function buildStatementModel(input: BuildStatementModelInput): StatementModel {
  const rows: StatementRow[] = input.items.map((it) => ({
    date: it.createdAt,
    type: it.type,
    status: it.status,
    direction: it.direction,
    amount: signedAmount(it),
    reference: it.receiptNumber ?? it.id,
  }));

  return {
    title: 'Transaction Statement',
    accountLabel: input.accountLabel,
    windowLabel: input.windowLabel,
    generatedAt: input.generatedAt,
    rows,
    totalCount: input.totalCount,
    truncated: input.truncated,
    filename: input.filename,
  };
}

function signedAmount(it: TransactionHistoryItem): string {
  const sign = it.direction === 'in' ? '+' : '-';
  const value = it.cryptoAmount ?? it.fiatAmount ?? '';
  return value ? `${sign}${value}` : '';
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @handshake-agent/api test -- statement-model`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/transactions/application/ports/statement-generator.port.ts api/src/modules/transactions/application/statement-model.ts api/src/modules/transactions/application/statement-model.spec.ts
git commit -m "feat(api): statement generator port + pure statement-model builder"
```

---

## Task 8: Infrastructure — `PdfStatementGenerator` (pdfkit)

**Files:**
- Create: `api/src/modules/transactions/infrastructure/pdf-statement.generator.ts`
- Test: `api/src/modules/transactions/infrastructure/pdf-statement.generator.spec.ts`

**Interfaces:**
- Consumes: `StatementModel` (Task 7), `pdfkit`.
- Produces: `PdfStatementGenerator implements IStatementGenerator` → `{ buffer (a real PDF), contentType:'application/pdf', filename }`.

- [ ] **Step 1: Write the failing test**

```ts
// api/src/modules/transactions/infrastructure/pdf-statement.generator.spec.ts
import { PdfStatementGenerator } from './pdf-statement.generator';
import type { StatementModel } from '../application/ports/statement-generator.port';

const model: StatementModel = {
  title: 'Transaction Statement',
  accountLabel: 'u***@test.com',
  windowLabel: 'This month',
  generatedAt: '2026-06-29T10:00:00.000Z',
  filename: 'handshake-statement-2026-06-01_2026-06-29.pdf',
  totalCount: 1,
  truncated: false,
  rows: [
    { date: '2026-06-10T10:00:00.000Z', type: 'buy', status: 'completed', direction: 'in', amount: '+29.97 USDT', reference: 'HS-2026-000001' },
  ],
};

describe('PdfStatementGenerator', () => {
  it('produces a valid PDF buffer with the right content-type and filename', async () => {
    const gen = new PdfStatementGenerator();
    const file = await gen.generate(model);
    expect(file.contentType).toBe('application/pdf');
    expect(file.filename).toBe(model.filename);
    expect(file.buffer.length).toBeGreaterThan(100);
    expect(file.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('handles an empty / truncated statement', async () => {
    const gen = new PdfStatementGenerator();
    const file = await gen.generate({ ...model, rows: [], totalCount: 150, truncated: true });
    expect(file.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- pdf-statement`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pdfkit adapter**

```ts
// api/src/modules/transactions/infrastructure/pdf-statement.generator.ts
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';

import type {
  IStatementGenerator,
  StatementFile,
  StatementModel,
} from '../application/ports/statement-generator.port';

/**
 * Renders a StatementModel to a PDF Buffer with pdfkit (built-in Helvetica, no
 * external font files). Deterministic: CreationDate comes from the model's
 * generatedAt (set from CLOCK upstream), never wall-clock.
 */
@Injectable()
export class PdfStatementGenerator implements IStatementGenerator {
  async generate(model: StatementModel): Promise<StatementFile> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: model.title,
        Producer: 'Handshake Agent',
        CreationDate: new Date(model.generatedAt),
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    // Header
    doc.fontSize(18).text(model.title, { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#555555');
    doc.text(`Account: ${model.accountLabel}`);
    doc.text(`Period: ${model.windowLabel}`);
    doc.text(`Generated: ${model.generatedAt}`);
    doc.moveDown(0.6);
    doc.fillColor('#000000');

    // Rows
    if (model.rows.length === 0) {
      doc.fontSize(11).text('No transactions in this period.');
    } else {
      for (const r of model.rows) {
        doc
          .fontSize(10)
          .text(
            `${r.date}   ${r.type.toUpperCase()}   ${r.amount}   [${r.status}]   ${r.reference}`,
          );
      }
    }

    // Footer / truncation notice (no silent caps — surface it).
    doc.moveDown(0.6).fontSize(9).fillColor('#555555');
    if (model.truncated) {
      doc.text(
        `Showing the latest ${model.rows.length} of ${model.totalCount} transactions. Narrow the date range for the rest.`,
      );
    } else {
      doc.text(`${model.totalCount} transaction(s).`);
    }

    doc.end();
    const buffer = await done;
    return { buffer, contentType: 'application/pdf', filename: model.filename };
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @handshake-agent/api test -- pdf-statement`
Expected: PASS (2 tests).
(If `import PDFDocument from 'pdfkit'` fails under ts-jest/CJS, use `import PDFDocument = require('pdfkit');` — pdfkit is CJS with a default export.)

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/transactions/infrastructure/pdf-statement.generator.ts api/src/modules/transactions/infrastructure/pdf-statement.generator.spec.ts
git commit -m "feat(api): pdfkit statement generator (deterministic CreationDate)"
```

---

## Task 9: Port + Prisma — `listByUserInRange`

**Files:**
- Modify: `api/src/modules/transactions/application/ports/transaction.repository.port.ts`
- Modify: `api/src/modules/transactions/infrastructure/transaction.prisma.repository.ts`

**Interfaces:**
- Produces: `ITransactionRepository.listByUserInRange(input) → { rows: TransactionRecord[]; total: number }` where `input = { userId; from: Date; to: Date; types?: string[]; limit: number }`.

> Repository adapters in this codebase are verified in the e2e lane (real Postgres), not by mocked unit tests. This task adds the method + impl; runtime coverage lands in Task 15's e2e. Verify it compiles here.

- [ ] **Step 1: Add the method to the port interface**

In `api/src/modules/transactions/application/ports/transaction.repository.port.ts`, add to `interface ITransactionRepository`:

```ts
  /**
   * Read-only history query: transactions for a user within [from, to], optionally
   * filtered by type. Returns the page (capped at `limit`, newest first) AND the
   * exact total count of matching rows in the window. Used by TransactionHistoryService
   * — never mutates. Scoped to `userId` (the security boundary for read-only own data).
   */
  listByUserInRange(input: {
    userId: string;
    from: Date;
    to: Date;
    types?: string[];
    limit: number;
  }): Promise<{ rows: TransactionRecord[]; total: number }>;
```

- [ ] **Step 2: Implement it in the Prisma adapter**

In `api/src/modules/transactions/infrastructure/transaction.prisma.repository.ts`, add this method to the `TransactionPrismaRepository` class (it reuses the existing module-level `TRANSACTION_SELECT` and `toRecord`, and the already-imported `TransactionType` + `Prisma`):

```ts
  async listByUserInRange(input: {
    userId: string;
    from: Date;
    to: Date;
    types?: string[];
    limit: number;
  }): Promise<{ rows: TransactionRecord[]; total: number }> {
    const where: Prisma.TransactionWhereInput = {
      userId: input.userId,
      createdAt: { gte: input.from, lte: input.to },
      ...(input.types && input.types.length > 0
        ? { type: { in: input.types as TransactionType[] } }
        : {}),
    };

    // One round-trip: the capped page (newest first) + the exact total count.
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        select: TRANSACTION_SELECT,
        orderBy: { createdAt: 'desc' },
        take: input.limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { rows: rows.map(toRecord), total };
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter @handshake-agent/api typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/transactions/application/ports/transaction.repository.port.ts api/src/modules/transactions/infrastructure/transaction.prisma.repository.ts
git commit -m "feat(api): add listByUserInRange read query to transaction repository"
```

---

## Task 10: Application — `TransactionHistoryService` + module wiring

**Files:**
- Create: `api/src/modules/transactions/application/transaction-history.service.ts`
- Test: `api/src/modules/transactions/application/transaction-history.service.spec.ts`
- Modify: `api/src/modules/transactions/transactions.module.ts`

**Interfaces:**
- Consumes: `TRANSACTION_REPOSITORY` (`listByUserInRange`), `SETTLEMENT_REPOSITORY` (`findReceiptNumber`), `AssetRegistry`, `CLOCK`, `ConfigService`, `StatementTokenService`.
- Produces: `TransactionHistoryService.query(userId, spec) → TransactionHistoryResponse`; `queryResolved(input) → { window; items; totalCount; truncated }`; `buildStatementFor(payload) → { model-input pieces }` helper used by the download controller (Task 11). Exports `TransactionHistoryService` + `StatementTokenService` + `STATEMENT_GENERATOR` from `TransactionsModule`.

- [ ] **Step 1: Write the failing test**

```ts
// api/src/modules/transactions/application/transaction-history.service.spec.ts
import { ConfigService } from '@nestjs/config';
import { TransactionHistoryService } from './transaction-history.service';
import { AssetRegistry } from '../../../core/catalog/asset-registry';

const STATEMENT_CFG = { linkTtlSeconds: 900, maxWindowDays: 365, rowCap: 2, timezoneOffsetMinutes: 60 };

// Minimal real AssetRegistry over a tiny catalog (no Nest test bed needed).
function makeRegistry(): AssetRegistry {
  const catalog = {
    assets: { USDT: { symbol: 'USDT', displayName: 'USDT', kind: 'crypto', decimals: 6, networks: ['TRON'], providers: {}, enabled: true } },
    fiats: { NGN: { code: 'NGN', displayName: 'Naira', symbol: '₦', decimals: 2, enabled: true } },
    networks: { TRON: { id: 'TRON', displayName: 'TRON', addressPattern: '^T.+$', enabled: true, networkFeeCrypto: {} } },
    capabilities: {}, sendQuoteExpiresInSec: 30,
  };
  const config = { get: (k: string) => (k === 'catalog' ? catalog : undefined) } as unknown as ConfigService;
  return new AssetRegistry(config);
}

function makeService(rows: any[], total: number) {
  const txRepo = { listByUserInRange: jest.fn().mockResolvedValue({ rows, total }) };
  const settlementRepo = { findReceiptNumber: jest.fn().mockResolvedValue('HS-2026-000001') };
  const config = {
    get: (k: string) => (k === 'statement' ? STATEMENT_CFG : k === 'PUBLIC_API_BASE_URL' ? 'https://api.example.com' : k === 'STATEMENT_SIGNING_KEY' ? 'k'.repeat(32) : k === 'PORT' ? 3001 : undefined),
  } as unknown as ConfigService;
  const clock = { now: () => new Date('2026-06-29T10:00:00.000Z') };
  const token = { sign: jest.fn().mockReturnValue('tok'), buildDownloadUrl: jest.fn().mockReturnValue('https://api.example.com/transactions/statement/download?token=tok') };
  const svc = new TransactionHistoryService(txRepo as any, settlementRepo as any, makeRegistry(), clock as any, config, token as any);
  return { svc, txRepo, settlementRepo, token };
}

const buyRow = { id: 't1', userId: 'u1', type: 'buy', status: 'completed', metadata: { asset: 'USDT', cryptoAmount: '29.97', fiatAmount: '50000', fiatCurrency: 'NGN' }, createdAt: new Date('2026-06-10T10:00:00.000Z') };
const sendRow = { id: 't2', userId: 'u1', type: 'send', status: 'settling', metadata: { asset: 'USDT', cryptoAmount: '10' }, createdAt: new Date('2026-06-12T09:00:00.000Z') };

describe('TransactionHistoryService.query', () => {
  it('maps rows: direction, formatted amounts, receiptNumber for completed', async () => {
    const { svc, settlementRepo } = makeService([buyRow, sendRow], 2);
    const res = await svc.query('u1', { period: 'this_month' });
    expect(res.items[0]).toMatchObject({ id: 't1', direction: 'in', cryptoAmount: '29.97 USDT', fiatAmount: '₦50,000.00', receiptNumber: 'HS-2026-000001' });
    expect(res.items[1]).toMatchObject({ id: 't2', direction: 'out', cryptoAmount: '10 USDT' });
    expect(res.items[1].receiptNumber).toBeUndefined(); // settling → no receipt lookup
    expect(settlementRepo.findReceiptNumber).toHaveBeenCalledTimes(1);
    expect(res.totalCount).toBe(2);
    expect(res.truncated).toBe(false);
    expect(res.downloadUrl).toContain('token=tok');
  });

  it('sets truncated when total exceeds the returned page', async () => {
    const { svc } = makeService([buyRow, sendRow], 5); // rowCap=2, total=5
    const res = await svc.query('u1', { period: 'all' });
    expect(res.truncated).toBe(true);
    expect(res.totalCount).toBe(5);
  });

  it('maps txType=receive to the deposit engine type', async () => {
    const { svc, txRepo } = makeService([], 0);
    await svc.query('u1', { txType: 'receive' });
    expect(txRepo.listByUserInRange).toHaveBeenCalledWith(expect.objectContaining({ types: ['deposit'] }));
  });

  it('passes all money-moving types when txType is omitted', async () => {
    const { svc, txRepo } = makeService([], 0);
    await svc.query('u1', {});
    expect(txRepo.listByUserInRange).toHaveBeenCalledWith(expect.objectContaining({ types: ['buy', 'sell', 'send', 'deposit'] }));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- transaction-history.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
// api/src/modules/transactions/application/transaction-history.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  TransactionHistoryItem,
  TransactionHistoryResponse,
} from '@handshake-agent/contracts';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { CLOCK, type Clock } from '../../../core/common/clock';
import type { Env } from '../../../core/config/env.schema';

import {
  TRANSACTION_REPOSITORY,
  type ITransactionRepository,
  type TransactionRecord,
} from './ports/transaction.repository.port';
import {
  SETTLEMENT_REPOSITORY,
  type ISettlementRepository,
} from './ports/settlement.repository.port';
import { StatementTokenService } from './statement-token.service';
import { resolveWindow, type QueryWindowSpec, type StatementWindow } from '../domain/statement-window';

export interface QueryTransactionsSpec extends QueryWindowSpec {
  txType?: 'buy' | 'sell' | 'send' | 'receive' | 'all';
}

const TYPE_FILTER_MAP: Record<string, string[]> = {
  buy: ['buy'],
  sell: ['sell'],
  send: ['send'],
  receive: ['deposit'],
};
const ALL_MONEY_TYPES = ['buy', 'sell', 'send', 'deposit'];
const INFLOW_TYPES = new Set(['buy', 'deposit', 'reward', 'refund']);

@Injectable()
export class TransactionHistoryService {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly txRepo: ITransactionRepository,
    @Inject(SETTLEMENT_REPOSITORY) private readonly settlementRepo: ISettlementRepository,
    private readonly assets: AssetRegistry,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: ConfigService<Env, true>,
    private readonly tokens: StatementTokenService,
  ) {}

  /** Resolve the window from a spec, then read + map. Used by web + WhatsApp. */
  async query(userId: string, spec: QueryTransactionsSpec): Promise<TransactionHistoryResponse> {
    const cfg = this.config.get('statement', { infer: true })!;
    const window = resolveWindow(spec, this.clock.now(), {
      maxWindowDays: cfg.maxWindowDays,
      timezoneOffsetMinutes: cfg.timezoneOffsetMinutes,
    });
    const txType = spec.txType ?? 'all';
    const inner = await this.queryResolved({ userId, from: window.from, to: window.to, txType });

    const token = this.tokens.sign({
      userId,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      txType,
    });

    return {
      window: { from: window.from.toISOString(), to: window.to.toISOString(), label: window.label },
      items: inner.items,
      totalCount: inner.totalCount,
      truncated: inner.truncated,
      downloadUrl: this.tokens.buildDownloadUrl(token),
    };
  }

  /** Read + map for an already-resolved window (used by the signed download path). */
  async queryResolved(input: {
    userId: string;
    from: Date;
    to: Date;
    txType: string;
  }): Promise<{ items: TransactionHistoryItem[]; totalCount: number; truncated: boolean }> {
    const cfg = this.config.get('statement', { infer: true })!;
    const types = TYPE_FILTER_MAP[input.txType] ?? ALL_MONEY_TYPES;

    const { rows, total } = await this.txRepo.listByUserInRange({
      userId: input.userId,
      from: input.from,
      to: input.to,
      types,
      limit: cfg.rowCap,
    });

    const items = await Promise.all(rows.map((r) => this.toItem(r)));
    return { items, totalCount: total, truncated: total > rows.length };
  }

  private async toItem(row: TransactionRecord): Promise<TransactionHistoryItem> {
    const meta = row.metadata;
    const asset = typeof meta.asset === 'string' ? meta.asset : undefined;
    const cryptoRaw = typeof meta.cryptoAmount === 'string' ? meta.cryptoAmount : undefined;
    const fiatRaw = typeof meta.fiatAmount === 'string' ? meta.fiatAmount : undefined;
    const fiatCurrency = typeof meta.fiatCurrency === 'string' ? meta.fiatCurrency : undefined;

    let receiptNumber: string | undefined;
    if (row.status === 'completed') {
      receiptNumber = (await this.settlementRepo.findReceiptNumber(row.id)) ?? undefined;
    }

    return {
      id: row.id,
      type: row.type,
      status: row.status,
      direction: INFLOW_TYPES.has(row.type) ? 'in' : 'out',
      ...(asset ? { asset } : {}),
      ...(asset && cryptoRaw ? { cryptoAmount: this.assets.formatCrypto(asset, cryptoRaw) } : {}),
      ...(fiatCurrency && fiatRaw ? { fiatAmount: this.assets.formatFiat(fiatCurrency, fiatRaw) } : {}),
      ...(fiatCurrency ? { fiatCurrency } : {}),
      createdAt: row.createdAt.toISOString(),
      ...(receiptNumber ? { receiptNumber } : {}),
    };
  }
}
```

- [ ] **Step 4: Wire it into `TransactionsModule`**

In `api/src/modules/transactions/transactions.module.ts`: add imports + register `TransactionHistoryService`, `StatementTokenService`, and the `STATEMENT_GENERATOR` binding, and export the first two + the generator token. Add:

```ts
import { TransactionHistoryService } from './application/transaction-history.service';
import { StatementTokenService } from './application/statement-token.service';
import { STATEMENT_GENERATOR } from './application/ports/statement-generator.port';
import { PdfStatementGenerator } from './infrastructure/pdf-statement.generator';
```

In `providers`, add:

```ts
    TransactionHistoryService,
    StatementTokenService,
    { provide: STATEMENT_GENERATOR, useClass: PdfStatementGenerator },
```

In `exports`, add:

```ts
    TransactionHistoryService,
    StatementTokenService,
    STATEMENT_GENERATOR,
```

(`AssetRegistry` is global via `CatalogModule`; `CLOCK` is already provided in this module; `ConfigService` is global.)

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @handshake-agent/api test -- transaction-history.service`
Expected: PASS (4 tests).
Run: `pnpm --filter @handshake-agent/api typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/transactions/application/transaction-history.service.ts api/src/modules/transactions/application/transaction-history.service.spec.ts api/src/modules/transactions/transactions.module.ts
git commit -m "feat(api): read-only TransactionHistoryService + module wiring"
```

---

## Task 11: Presentation — history + statement endpoints

**Files:**
- Create: `api/src/modules/chat/presentation/transaction-history.controller.ts`
- Modify: `api/src/modules/chat/chat.module.ts`

**Interfaces:**
- Produces: `GET /transactions/history?period=&from=&to=&txType=` (JWT) → `TransactionHistoryResponse`; `GET /transactions/statement/download?token=` (public) → streamed PDF.
- Consumes: `TransactionHistoryService`, `StatementTokenService`, `STATEMENT_GENERATOR`, `buildStatementModel`, `JwtAuthGuard`, `@CurrentUser()`.

> Both routes are verified end-to-end in Task 15. This task delivers controllers + wiring; verify compile here.

- [ ] **Step 1: Create the controller file**

```ts
// api/src/modules/chat/presentation/transaction-history.controller.ts
/**
 * Transaction-history read endpoints.
 *
 *   GET /transactions/history            — JWT; the authenticated user's history.
 *   GET /transactions/statement/download — PUBLIC; authorized by a signed token
 *                                          (so a browser opened from a WhatsApp
 *                                          link works). Streams a PDF statement.
 *
 * Security: history is scoped to the JWT user's id; the download token is bound to
 * a single userId + window. Read-only — the engine is never touched (§3.1).
 *
 * Route ordering: registered BEFORE TransactionStatusController so the literal
 * `transactions/history` path is matched before `transactions/:id` (Express 5).
 */
import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import type { TransactionHistoryResponse } from '@handshake-agent/contracts';

import {
  JwtAuthGuard,
  type AuthenticatedUser,
} from '../../auth/presentation/jwt-auth.guard';
import { CurrentUser } from '../../auth/presentation/current-user.decorator';

import { TransactionHistoryService } from '../../transactions/application/transaction-history.service';
import {
  StatementTokenService,
  StatementTokenInvalidError,
  StatementNotSignableError,
} from '../../transactions/application/statement-token.service';
import {
  STATEMENT_GENERATOR,
  type IStatementGenerator,
} from '../../transactions/application/ports/statement-generator.port';
import { buildStatementModel } from '../../transactions/application/statement-model';

const PERIODS = new Set([
  'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'all',
]);
const TX_TYPES = new Set(['buy', 'sell', 'send', 'receive', 'all']);

@Controller('transactions/history')
@UseGuards(JwtAuthGuard)
export class TransactionHistoryController {
  constructor(private readonly history: TransactionHistoryService) {}

  @Get()
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('txType') txType?: string,
  ): Promise<TransactionHistoryResponse> {
    if (period !== undefined && !PERIODS.has(period)) {
      throw new BadRequestException('invalid period');
    }
    if (txType !== undefined && !TX_TYPES.has(txType)) {
      throw new BadRequestException('invalid txType');
    }
    return this.history.query(user.userId, {
      period: period as never,
      from,
      to,
      txType: txType as never,
    });
  }
}

@Controller('transactions/statement')
export class StatementDownloadController {
  constructor(
    private readonly history: TransactionHistoryService,
    private readonly tokens: StatementTokenService,
    @Inject(STATEMENT_GENERATOR) private readonly generator: IStatementGenerator,
  ) {}

  @Get('download')
  async download(
    @Query('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Buffer> {
    let payload;
    try {
      payload = this.tokens.verify(token ?? '');
    } catch (err) {
      if (err instanceof StatementNotSignableError) {
        throw new ServiceUnavailableException('Statement downloads are not configured');
      }
      if (err instanceof StatementTokenInvalidError) {
        throw new UnauthorizedException('Invalid or expired download link');
      }
      throw err;
    }

    const from = new Date(payload.from);
    const to = new Date(payload.to);
    const inner = await this.history.queryResolved({
      userId: payload.userId,
      from,
      to,
      txType: payload.txType,
    });

    const fromDay = payload.from.slice(0, 10);
    const toDay = payload.to.slice(0, 10);
    const model = buildStatementModel({
      items: inner.items,
      totalCount: inner.totalCount,
      truncated: inner.truncated,
      windowLabel: `${fromDay} – ${toDay}`,
      accountLabel: maskUser(payload.userId),
      generatedAt: to.toISOString(),
      filename: `handshake-statement-${fromDay}_${toDay}.pdf`,
    });

    const file = await this.generator.generate(model);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': String(file.buffer.length),
    });
    return file.buffer;
  }
}

function maskUser(userId: string): string {
  return userId.length <= 8 ? userId : `${userId.slice(0, 8)}…`;
}
```

- [ ] **Step 2: Register the controllers in `ChatModule`**

In `api/src/modules/chat/chat.module.ts`, import the new controllers and add them to `controllers` **before** `TransactionStatusController` (so `transactions/history` resolves before `transactions/:id`):

```ts
import {
  TransactionHistoryController,
  StatementDownloadController,
} from './presentation/transaction-history.controller';
```

```ts
  controllers: [
    ChatController,
    ProposalController,
    TransactionHistoryController,
    StatementDownloadController,
    TransactionStatusController,
  ],
```

(`ChatModule` already imports `TransactionsModule` (exports the service/token/generator) and `WebAuthModule` (exports `JwtAuthGuard`).)

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter @handshake-agent/api typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/chat/presentation/transaction-history.controller.ts api/src/modules/chat/chat.module.ts
git commit -m "feat(api): JWT history endpoint + public signed statement-download endpoint"
```

---

## Task 12: Agent — extract `query_transactions` (system prompt)

**Files:**
- Modify: `api/src/modules/agent/infrastructure/anthropic-llm.provider.ts`
- Modify: `api/src/modules/agent/infrastructure/anthropic-llm.provider.spec.ts`

**Interfaces:**
- Consumes: nothing new (only edits the prompt string). The agent core stays DB-free (§3.2).

- [ ] **Step 1: Add a failing prompt assertion**

Append to `api/src/modules/agent/infrastructure/anthropic-llm.provider.spec.ts` (inside the existing `describe` that calls `buildSystemPrompt()`):

```ts
  it('documents the query_transactions action and the no-date-math rule', () => {
    // `provider` is the AnthropicLlmProvider instance built in the existing setup.
    const prompt = provider.buildSystemPrompt();
    expect(prompt).toContain('query_transactions');
    expect(prompt).toMatch(/never compute (calendar )?dates/i);
    expect(prompt).toContain('download');
  });
```

(If the existing spec names the instance differently, use that name — it constructs `AnthropicLlmProvider` with a fake `ConfigService` + `AssetRegistry` and asserts on `buildSystemPrompt()`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- anthropic-llm.provider`
Expected: FAIL — prompt lacks `query_transactions`.

- [ ] **Step 3: Update `buildSystemPrompt`**

In `api/src/modules/agent/infrastructure/anthropic-llm.provider.ts`, add the action to the bulleted list (after `check_balance`):

```
- query_transactions: user wants to see their transaction history / past activity, or download a statement
```

and add these rules to the numbered `Rules:` block (after rule 4):

```
5. For query_transactions: choose a "period" from today, yesterday, this_week, last_week, this_month, last_month, or all for relative phrases ("today", "last week", "this month"). NEVER compute calendar dates yourself.
6. Only set "from"/"to" (ISO YYYY-MM-DD) when the user states an explicit calendar range (e.g. "from June 1 to June 15"). Set "txType" (buy/sell/send/receive) when the user names a direction (e.g. "what did I send"). Set "download": true only when the user asks for a file/statement/PDF.
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @handshake-agent/api test -- anthropic-llm.provider`
Expected: PASS.

- [ ] **Step 5: Verify the agent boundary stays clean**

Run: `pnpm --filter @handshake-agent/api depcruise` (or from root: `pnpm depcruise`)
Expected: no new violations (agent imports no DB/Prisma).

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/agent/infrastructure/anthropic-llm.provider.ts api/src/modules/agent/infrastructure/anthropic-llm.provider.spec.ts
git commit -m "feat(api): teach the agent to extract query_transactions intents"
```

---

## Task 13: Web routing — `WebChatService` outcome

**Files:**
- Modify: `api/src/modules/chat/application/web-chat.service.ts`
- Modify: `api/src/modules/chat/chat.module.ts`
- Modify: `api/src/modules/chat/application/web-chat.service.spec.ts`

**Interfaces:**
- Consumes: `TransactionHistoryService` via a new local token `WEB_CHAT_HISTORY_SERVICE`.
- Produces: a `{ kind:'transactions', ... }` outcome for `query_transactions`.

- [ ] **Step 1: Add a failing test**

In `api/src/modules/chat/application/web-chat.service.spec.ts`, add a test that the agent returning `query_transactions` yields a `transactions` outcome. Mirror the existing setup (the spec builds `WebChatService` with mocked ports). Add a `fakeHistoryService = { query: jest.fn().mockResolvedValue(<response>) }` passed as the new constructor arg, and:

```ts
  it('routes query_transactions to a transactions outcome', async () => {
    agentPort.run.mockResolvedValue({ action: 'query_transactions', period: 'this_month', download: false });
    historyService.query.mockResolvedValue({
      window: { from: 'F', to: 'T', label: 'This month' },
      items: [], totalCount: 0, truncated: false,
      downloadUrl: 'https://api.example.com/transactions/statement/download?token=tok',
    });
    const res = await service.handleMessage({ userId: 'u1', text: 'my transactions this month' });
    expect(res.outcome.kind).toBe('transactions');
    expect(historyService.query).toHaveBeenCalledWith('u1', expect.objectContaining({ period: 'this_month' }));
  });
```

(Match the existing spec's variable names + how it instantiates the service; add the history mock as the final constructor argument.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- web-chat.service`
Expected: FAIL — `outcome.kind` is `not_supported` (no branch yet) or constructor arity mismatch.

- [ ] **Step 3: Add the injection + the case**

In `api/src/modules/chat/application/web-chat.service.ts`:

Add the token near the other `WEB_CHAT_*` tokens:

```ts
export const WEB_CHAT_HISTORY_SERVICE = Symbol('WEB_CHAT_HISTORY_SERVICE');
```

Add the import and constructor param:

```ts
import type { TransactionHistoryService } from '../../transactions/application/transaction-history.service';
// ...in the constructor:
    @Inject(WEB_CHAT_HISTORY_SERVICE)
    private readonly historyService: TransactionHistoryService,
```

Add the case to the `switch (intent.action)` (before the `check_balance | swap | buy_ticket` case):

```ts
      case 'query_transactions': {
        const result = await this.historyService.query(userId, {
          period: intent.period,
          from: intent.from,
          to: intent.to,
          txType: intent.txType,
        });
        outcome = { kind: 'transactions', ...result };
        summaryText =
          result.totalCount > 0
            ? `Found ${result.totalCount} transaction(s) for ${result.window.label}.`
            : `No transactions for ${result.window.label}.`;
        break;
      }
```

- [ ] **Step 4: Bind the token in `ChatModule`**

In `api/src/modules/chat/chat.module.ts`, import the service + token and add the `useExisting` binding:

```ts
import { TransactionHistoryService } from '../transactions/application/transaction-history.service';
// add WEB_CHAT_HISTORY_SERVICE to the existing import from './application/web-chat.service'
```

```ts
    { provide: WEB_CHAT_HISTORY_SERVICE, useExisting: TransactionHistoryService },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @handshake-agent/api test -- web-chat.service`
Expected: PASS.
Run: `pnpm --filter @handshake-agent/api typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/chat/
git commit -m "feat(api): route query_transactions to a transactions chat outcome (web)"
```

---

## Task 14: WhatsApp routing — `ConversationService` handler

**Files:**
- Modify: `api/src/modules/conversations/application/conversation.service.ts`
- Modify: `api/src/modules/conversations/conversations.module.ts`
- Modify: `api/src/modules/conversations/application/conversation.service.spec.ts`

**Interfaces:**
- Consumes: `TransactionHistoryService` via a new local token `TRANSACTION_HISTORY_SERVICE`; `IWhatsAppSender.sendText` + `sendCtaUrl`.
- Produces: a `query_transactions` route → text list + signed download CTA.

- [ ] **Step 1: Add a failing test**

In `api/src/modules/conversations/application/conversation.service.spec.ts`, add a test driving a `query_transactions` intent for a linked user. Mirror the existing setup (it builds `ConversationService` with mocked deps; add a `fakeHistory = { query: jest.fn() }` as the new constructor arg under its token). Assert:

```ts
  it('query_transactions (linked user) sends a text list + a download CTA', async () => {
    // identity resolves to a linked user; agent returns the intent.
    agentPort.run.mockResolvedValue({ action: 'query_transactions', period: 'today', download: true });
    history.query.mockResolvedValue({
      window: { from: 'F', to: 'T', label: 'Today' },
      items: [{ id: 't1', type: 'buy', status: 'completed', direction: 'in', cryptoAmount: '29.97 USDT', createdAt: '2026-06-29T09:00:00.000Z' }],
      totalCount: 1, truncated: false,
      downloadUrl: 'https://api.example.com/transactions/statement/download?token=tok',
    });
    await service.handleInbound(makeInbound('my transactions today'));
    expect(sender.sendText).toHaveBeenCalled();
    expect(sender.sendCtaUrl).toHaveBeenCalledWith(expect.objectContaining({ buttonText: 'Download', url: expect.stringContaining('token=tok') }));
  });
```

(Use the spec's existing helpers for a linked-user identity + `makeInbound`. Add `history` as the matching constructor mock.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @handshake-agent/api test -- conversation.service`
Expected: FAIL — no `query_transactions` route / constructor arity mismatch.

- [ ] **Step 3: Add the token, injection, route, and handler**

In `api/src/modules/conversations/application/conversation.service.ts`:

Add the token near the others:

```ts
/** DI token for TransactionHistoryService — injected by symbol (read-only history). */
export const TRANSACTION_HISTORY_SERVICE = Symbol('TRANSACTION_HISTORY_SERVICE');
```

Add the import + constructor param:

```ts
import type { TransactionHistoryService } from '../../transactions/application/transaction-history.service';
import type { QueryTransactionsIntent } from '@handshake-agent/contracts';
// ...constructor:
    @Inject(TRANSACTION_HISTORY_SERVICE)
    private readonly historyService: TransactionHistoryService,
```

Add a constant near `SAFE_FALLBACK`:

```ts
/** Max history lines rendered in a WhatsApp text reply (the full set is in the PDF). */
const MAX_WA_HISTORY_LINES = 20;
```

Add the route to `routeIntent`'s switch (before `default`):

```ts
      case 'query_transactions': {
        const { replyText, flowSent } = await this.handleTransactionHistory(
          intent as unknown as QueryTransactionsIntent,
          identity,
          msg,
        );
        return { replyText, flowSent };
      }
```

Add the handler (place it near `handleReceive`):

```ts
  private async handleTransactionHistory(
    intent: QueryTransactionsIntent,
    identity: ResolvedIdentity,
    msg: InboundMessage,
  ): Promise<{ replyText: string; flowSent: boolean }> {
    const guard = this.requireActiveUser(identity, msg.fromAddress);
    if ('needsKyc' in guard) {
      const replyText = await this.sendKycHandoff(guard.channelAddress);
      return { replyText, flowSent: false };
    }
    if ('needsReverify' in guard) {
      return { replyText: this.reverifyFallbackReply(), flowSent: false };
    }
    if ('reply' in guard) {
      return { replyText: guard.reply, flowSent: false };
    }

    const result = await this.historyService.query(guard.user.id, {
      period: intent.period,
      from: intent.from,
      to: intent.to,
      txType: intent.txType,
    });

    if (result.totalCount === 0) {
      return { replyText: `No transactions for ${result.window.label}.`, flowSent: false };
    }

    // Send the list, then a CTA URL to the signed PDF. Returning flowSent:true
    // tells handleInbound NOT to re-send replyText (we've already dispatched).
    await this.sender.sendText(msg.fromAddress, this.buildHistoryText(result));
    await this.sender.sendCtaUrl({
      to: msg.fromAddress,
      body: `Download your statement (${result.window.label})`,
      buttonText: 'Download',
      url: result.downloadUrl,
    });
    return {
      replyText: `Sent your ${result.window.label} statement.`,
      flowSent: true,
    };
  }

  /** Builds a plain-text history list (date · type · ±amount · status). */
  private buildHistoryText(result: {
    window: { label: string };
    items: Array<{
      type: string;
      status: string;
      direction: 'in' | 'out';
      cryptoAmount?: string;
      fiatAmount?: string;
      createdAt: string;
    }>;
    totalCount: number;
  }): string {
    const shown = result.items.slice(0, MAX_WA_HISTORY_LINES);
    const lines = shown.map((it) => {
      const sign = it.direction === 'in' ? '+' : '-';
      const amount = it.cryptoAmount ?? it.fiatAmount ?? '';
      const day = it.createdAt.slice(0, 10);
      return `${day}  ${it.type.toUpperCase()}  ${sign}${amount}  [${it.status}]`;
    });
    const header = `Your transactions (${result.window.label}):`;
    const more =
      result.totalCount > shown.length
        ? `\n…and ${result.totalCount - shown.length} more — download the statement for the full list.`
        : '';
    return `${header}\n${lines.join('\n')}${more}`;
  }
```

- [ ] **Step 4: Bind the token in `ConversationsModule`**

In `api/src/modules/conversations/conversations.module.ts`, import `TransactionHistoryService` + the token and add the `useExisting` binding (TransactionsModule is already imported + exports it):

```ts
import { TransactionHistoryService } from '../transactions/application/transaction-history.service';
// add TRANSACTION_HISTORY_SERVICE to the existing import from './application/conversation.service'
```

```ts
    { provide: TRANSACTION_HISTORY_SERVICE, useExisting: TransactionHistoryService },
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @handshake-agent/api test -- conversation.service`
Expected: PASS.
Run: `pnpm --filter @handshake-agent/api typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/conversations/
git commit -m "feat(api): route query_transactions to a WhatsApp text list + download CTA"
```

---

## Task 15: Backend e2e — outcome + history endpoint + statement download

**Files:**
- Create: `api/test/transaction-history.e2e-spec.ts`

**Interfaces:**
- Consumes everything above through the real `AppModule` (Testcontainers Postgres), with `LLM_PROVIDER` overridden to emit a `query_transactions` intent.

- [ ] **Step 1: Write the failing e2e**

```ts
// api/test/transaction-history.e2e-spec.ts
/**
 * Transaction-history — end-to-end (real AppModule + Testcontainers Postgres).
 *  - seed Transactions for a user, drive POST /chat/messages → transactions outcome
 *  - GET /transactions/history (JWT) returns the window + items; another user → empty
 *  - GET /transactions/statement/download?token=... → 200 application/pdf
 *  - tampered token → 401
 * Bootstrap mirrors web-chat.e2e-spec.ts (env set BEFORE AppModule import; fakes overridden).
 */
import { execSync } from 'node:child_process';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest') as typeof import('supertest');
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { INestApplication } from '@nestjs/common';

import { LLM_PROVIDER } from '../src/modules/agent/application/ports/agent.port';
import { WALLET_PROVIDER } from '../src/modules/wallets/application/ports/wallet-provider.port';
import { PAYMENT_PROVIDER } from '../src/modules/treasury/application/ports/payment-provider.port';
import { WHATSAPP_SENDER } from '../src/modules/whatsapp/application/ports/whatsapp-sender.port';
import type { LlmProvider } from '../src/modules/agent/core/ports/llm-provider.port';

jest.setTimeout(180_000);
const API_ROOT = join(__dirname, '..');

describe('Transaction history — e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('postgres:16-alpine').start();
    const dbUrl = container.getConnectionUri();
    execSync('node_modules/.bin/prisma migrate deploy', {
      cwd: API_ROOT, env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'inherit',
    });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });
    await prisma.$connect();
    stop = async () => { await prisma.$disconnect(); await container.stop(); };

    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      WHATSAPP_PHONE_NUMBER_ID: 'test-pnid-e2e-txhist',
      WHATSAPP_ACCESS_TOKEN: 'e2e-wa-token-txhist',
      WHATSAPP_APP_SECRET: 'e2e-txhist-app-secret-123',
      WHATSAPP_VERIFY_TOKEN: 'e2e-txhist-verify',
      WHATSAPP_FLOW_ID: '',
      DIRECTIVE_SIGNING_KEY: 'e2e-txhist-directive-key-32bytes!!x',
      RECEIPT_SIGNING_KEY: 'e2e-txhist-receipt-key-32bytes!!!!',
      STATEMENT_SIGNING_KEY: 'e2e-txhist-statement-key-32bytes!!',
      PUBLIC_API_BASE_URL: 'http://localhost:3001',
      BLOCKRADAR_API_KEY: 'fake-blockradar-txhist',
      BLOCKRADAR_MASTER_WALLET_ID: 'fake-master-txhist',
      FLUTTERWAVE_SECRET_KEY: 'fake-flw-txhist',
      JWT_SECRET: 'e2e-txhist-jwt-secret-at-least-32-bytes!!',
      AUTH_DEV_EXPOSE_OTP: 'true',
    });
    delete process.env.ANTHROPIC_API_KEY;

    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');

    const fakeLlm: jest.Mocked<LlmProvider> = {
      extractIntent: jest.fn().mockResolvedValue({ action: 'query_transactions', period: 'all', download: true }),
    };
    const noopSender = {
      sendText: jest.fn().mockResolvedValue({ externalMessageId: 'x' }),
      sendTemplate: jest.fn().mockResolvedValue({ externalMessageId: 'x' }),
      sendCtaUrl: jest.fn().mockResolvedValue({ externalMessageId: 'x' }),
      sendFlow: jest.fn().mockResolvedValue({ externalMessageId: 'x' }),
      sendBeneficiaryFlow: jest.fn().mockResolvedValue({ externalMessageId: 'x' }),
    };
    const fakeWallet = {
      provisionAddress: jest.fn().mockResolvedValue({ address: 'Tfake', providerReference: 'r' }),
      getBalance: jest.fn().mockResolvedValue({ balances: [] }),
      withdraw: jest.fn(), getWithdrawalStatus: jest.fn(),
    };
    const fakePayment = {
      createCollection: jest.fn(), verify: jest.fn(),
      createPayout: jest.fn(), verifyPayout: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(false),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER).useValue(fakeLlm)
      .overrideProvider(WALLET_PROVIDER).useValue(fakeWallet)
      .overrideProvider(PAYMENT_PROVIDER).useValue(fakePayment)
      .overrideProvider(WHATSAPP_SENDER).useValue(noopSender)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  }, 120_000);

  afterAll(async () => { jest.restoreAllMocks(); await app?.close(); await stop?.(); });

  async function onboard(email: string, phone: string): Promise<{ accessToken: string; userId: string }> {
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email, phone }).expect(202);
    await request(app.getHttpServer()).post('/auth/verify-email').send({ token: su.body.devToken }).expect(200);
    const lr = await request(app.getHttpServer()).post('/auth/login/request').send({ email }).expect(202);
    const lv = await request(app.getHttpServer()).post('/auth/login/verify')
      .send({ email, otp: lr.body.devOtp, deviceFingerprint: `fp-${phone}` }).expect(200);
    const ks = await request(app.getHttpServer()).post('/kyc/submit')
      .set('Authorization', `Bearer ${lv.body.accessToken}`)
      .send({ firstName: 'A', lastName: 'B', nin: '22334455667', pin: '1234' }).expect(200);
    return { accessToken: lv.body.accessToken, userId: ks.body.userId };
  }

  async function seedTxn(userId: string, type: string, createdAt: Date) {
    await prisma.transaction.create({
      data: {
        userId, type: type as never, status: 'completed',
        idempotencyKey: crypto.randomUUID(), requestChecksum: 'chk',
        metadata: { asset: 'USDT', cryptoAmount: '10', fiatAmount: '16000', fiatCurrency: 'NGN' },
        createdAt,
      },
    });
  }

  it('POST /chat/messages → transactions outcome with a downloadUrl', async () => {
    const { accessToken, userId } = await onboard(`txh_${Date.now()}@t.com`, '+2348020000001');
    await seedTxn(userId, 'buy', new Date('2026-06-10T10:00:00.000Z'));
    await seedTxn(userId, 'send', new Date('2026-06-12T10:00:00.000Z'));

    const chat = await request(app.getHttpServer())
      .post('/chat/messages').set('Authorization', `Bearer ${accessToken}`)
      .send({ text: 'show my transactions' }).expect(200);

    expect(chat.body.outcome.kind).toBe('transactions');
    expect(chat.body.outcome.items.length).toBe(2);
    expect(chat.body.outcome.totalCount).toBe(2);
    expect(chat.body.outcome.downloadUrl).toContain('/transactions/statement/download?token=');
  }, 120_000);

  it('GET /transactions/history scopes to the user (other user → empty)', async () => {
    const a = await onboard(`txa_${Date.now()}@t.com`, '+2348020000002');
    await seedTxn(a.userId, 'buy', new Date('2026-06-10T10:00:00.000Z'));
    const b = await onboard(`txb_${Date.now()}@t.com`, '+2348020000003');

    const mine = await request(app.getHttpServer()).get('/transactions/history?period=all')
      .set('Authorization', `Bearer ${a.accessToken}`).expect(200);
    expect(mine.body.totalCount).toBeGreaterThanOrEqual(1);

    const theirs = await request(app.getHttpServer()).get('/transactions/history?period=all')
      .set('Authorization', `Bearer ${b.accessToken}`).expect(200);
    expect(theirs.body.totalCount).toBe(0);
  }, 120_000);

  it('GET /transactions/statement/download streams a PDF; tampered token → 401', async () => {
    const { accessToken, userId } = await onboard(`txd_${Date.now()}@t.com`, '+2348020000004');
    await seedTxn(userId, 'buy', new Date('2026-06-10T10:00:00.000Z'));

    const hist = await request(app.getHttpServer()).get('/transactions/history?period=all')
      .set('Authorization', `Bearer ${accessToken}`).expect(200);
    const url = hist.body.downloadUrl as string;
    const token = new URL(url).searchParams.get('token')!;

    const pdf = await request(app.getHttpServer())
      .get(`/transactions/statement/download?token=${encodeURIComponent(token)}`).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(pdf.body).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    await request(app.getHttpServer())
      .get(`/transactions/statement/download?token=${encodeURIComponent(token.slice(0, -2) + 'zz')}`)
      .expect(401);
  }, 120_000);

  it('GET /transactions/:id still resolves (no route collision with /history)', async () => {
    const { accessToken } = await onboard(`txc_${Date.now()}@t.com`, '+2348020000005');
    await request(app.getHttpServer())
      .get('/transactions/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${accessToken}`).expect(404); // not found, NOT a history payload
  }, 120_000);
});
```

- [ ] **Step 2: Run it to verify it fails first, then passes**

Run: `pnpm --filter @handshake-agent/api test:e2e -- transaction-history`
Expected: the suite runs against Testcontainers Postgres and PASSES (4 tests). (Requires the Docker daemon up. `crypto.randomUUID()` is available as a Node global; if the file complains, add `import { randomUUID } from 'node:crypto'` and use it in `seedTxn`.)

- [ ] **Step 3: Commit**

```bash
git add api/test/transaction-history.e2e-spec.ts
git commit -m "test(api): e2e for transaction-history outcome, history endpoint, statement download"
```

---

## Task 16: Frontend — transactions card + mapping

**Files:**
- Modify: `web/lib/schemas/chat.ts`
- Modify: `web/types/components.ts`
- Create: `web/components/chat/cards/transactions-card.tsx`
- Modify: `web/components/chat/chat-message.tsx`
- Modify: `web/lib/store/chat-store.ts`
- Test: `web/components/chat/cards/transactions-card.test.tsx`

**Interfaces:**
- Consumes: the contracts `transactions` outcome (`outcome.window`, `outcome.items`, `outcome.downloadUrl`, …).
- Produces: a `transactions` `ChatMessage` variant + `TransactionsCard`.

- [ ] **Step 1: Add the FE view-model schema**

In `web/lib/schemas/chat.ts`, add before `ChatMessageSchema`:

```ts
// transactions (history list)
export const TransactionRowSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  direction: z.enum(["in", "out"]),
  amount: z.string(), // pre-formatted signed display, e.g. "+29.97 USDT"
  sub: z.string(), // secondary line (date)
})
export type TransactionRow = z.infer<typeof TransactionRowSchema>

export const TransactionsViewSchema = z.object({
  kind: z.literal("transactions"),
  windowLabel: z.string(),
  rows: z.array(TransactionRowSchema),
  totalCount: z.number(),
  truncated: z.boolean(),
  downloadUrl: z.string(),
})
export type TransactionsView = z.infer<typeof TransactionsViewSchema>
```

and add it to the `ChatMessageSchema` discriminated union:

```ts
  MessageBaseSchema.merge(TransactionsViewSchema),
```

- [ ] **Step 2: Add the props type**

In `web/types/components.ts`, add (mirroring `ReceiveCardProps`):

```ts
import type { TransactionsView } from "@/lib/schemas"
// ...
export type TransactionsCardProps = TransactionsView & {
  density: Density
  className?: string
}
```

- [ ] **Step 3: Write the failing card test**

```tsx
// web/components/chat/cards/transactions-card.test.tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TransactionsCard } from "./transactions-card"

const base = {
  windowLabel: "This month",
  totalCount: 1,
  truncated: false,
  downloadUrl: "https://api.example.com/transactions/statement/download?token=tok",
  density: "mobile" as const,
}

describe("TransactionsCard", () => {
  it("renders rows and a download link", () => {
    render(
      <TransactionsCard
        {...base}
        rows={[{ id: "t1", type: "buy", status: "completed", direction: "in", amount: "+29.97 USDT", sub: "2026-06-10" }]}
      />
    )
    expect(screen.getByText("+29.97 USDT")).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /download/i })
    expect(link).toHaveAttribute("href", base.downloadUrl)
  })

  it("renders an empty state", () => {
    render(<TransactionsCard {...base} totalCount={0} rows={[]} />)
    expect(screen.getByText(/no transactions/i)).toBeInTheDocument()
  })

  it("shows a truncation note", () => {
    render(
      <TransactionsCard
        {...base}
        totalCount={150}
        truncated
        rows={[{ id: "t1", type: "buy", status: "completed", direction: "in", amount: "+10 USDT", sub: "2026-06-10" }]}
      />
    )
    expect(screen.getByText(/latest/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @handshake-agent/web test -- transactions-card`
Expected: FAIL — module not found.

- [ ] **Step 5: Create the card**

```tsx
// web/components/chat/cards/transactions-card.tsx
import { cn } from "@/lib/utils"
import type { TransactionsCardProps } from "@/types/components"

/**
 * TransactionsCard — chat card for a transaction-history query result.
 * Lists rows (date · type · signed amount · status) with in/out color cues
 * (never color alone — the +/- sign carries the meaning too), and a download
 * link to the signed PDF statement. Tokens only, no hex literals.
 */
export function TransactionsCard({
  windowLabel,
  rows,
  totalCount,
  truncated,
  downloadUrl,
  density,
  className,
}: TransactionsCardProps) {
  const isMobile = density === "mobile"

  return (
    <div
      className={cn(
        "overflow-hidden border border-border bg-card",
        isMobile ? "w-[88%] rounded-[20px] shadow-card" : "w-[92%] rounded-[16px]",
        className
      )}
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <p className="text-[12px] font-bold tracking-widest text-muted-foreground-subtle uppercase">
          Transactions
        </p>
        <span className="text-[12px] text-muted-foreground">{windowLabel}</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-[13.5px] text-muted-foreground">
          No transactions in this period.
        </p>
      ) : (
        <ul className="px-2 pb-1">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-[12px] px-2 py-2.5"
            >
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-foreground">
                  {r.type.toUpperCase()}
                </span>
                <span className="block text-[12px] text-muted-foreground-subtle">
                  {r.sub} · {r.status}
                </span>
              </span>
              <span
                className={cn(
                  "flex-none text-[13.5px] font-bold tabular-nums",
                  r.direction === "in" ? "text-success" : "text-foreground"
                )}
              >
                {r.amount}
              </span>
            </li>
          ))}
        </ul>
      )}

      {truncated && (
        <p className="px-4 pb-1 text-[11.5px] text-muted-foreground-subtle">
          Showing the latest {rows.length} of {totalCount}. Download for the full list.
        </p>
      )}

      <div className={cn(isMobile ? "px-4 pb-4 pt-2" : "px-[15px] pb-[15px] pt-2")}>
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "block w-full text-center font-bold text-accent-foreground bg-accent shadow-cta",
            isMobile ? "rounded-[14px] py-3.5 text-[15px]" : "rounded-[12px] py-3 text-[14px]"
          )}
        >
          Download statement (PDF)
        </a>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Render it in the message switch**

In `web/components/chat/chat-message.tsx`, import the card and add a case before the `default`:

```tsx
import { TransactionsCard } from "./cards/transactions-card"
// ...
          case "transactions":
            return <TransactionsCard {...message} density={density} />
```

(This also satisfies the existing `_exhaustive: never` check now that the union has a new member.)

- [ ] **Step 7: Map the outcome in the chat store**

In `web/lib/store/chat-store.ts`, add a branch in the outcome mapping (alongside the others):

```ts
    } else if (outcome.kind === "transactions") {
      messages.push({
        id: nextId(),
        role: "assistant",
        kind: "transactions",
        windowLabel: outcome.window.label,
        rows: outcome.items.map((it) => ({
          id: it.id,
          type: it.type,
          status: it.status,
          direction: it.direction,
          amount: `${it.direction === "in" ? "+" : "-"}${it.cryptoAmount ?? it.fiatAmount ?? ""}`,
          sub: it.createdAt.slice(0, 10),
        })),
        totalCount: outcome.totalCount,
        truncated: outcome.truncated,
        downloadUrl: outcome.downloadUrl,
      })
    }
```

- [ ] **Step 8: Run the FE tests + typecheck**

Run: `pnpm --filter @handshake-agent/web test -- transactions-card`
Expected: PASS (3 tests).
Run: `pnpm --filter @handshake-agent/web typecheck` (or `tsc --noEmit` per the web scripts)
Expected: no errors (the store mapping + exhaustive switch compile).

- [ ] **Step 9: Commit**

```bash
git add web/lib/schemas/chat.ts web/types/components.ts web/components/chat/cards/transactions-card.tsx web/components/chat/cards/transactions-card.test.tsx web/components/chat/chat-message.tsx web/lib/store/chat-store.ts
git commit -m "feat(web): transaction-history chat card + outcome mapping + download action"
```

---

## Final verification (after all tasks)

- [ ] `pnpm --filter @handshake-agent/api test` — all unit suites green.
- [ ] `pnpm --filter @handshake-agent/api test:e2e -- transaction-history` — e2e green (Docker up).
- [ ] `pnpm --filter @handshake-agent/web test` — FE suites green.
- [ ] `pnpm --filter @handshake-agent/api typecheck` && `pnpm --filter @handshake-agent/web typecheck` — clean.
- [ ] `pnpm depcruise` — clean (agent core still imports no DB/Prisma; invariant §3.2 preserved).
- [ ] **Manual smoke (optional, needs Anthropic credits):** `PORT=3001 pnpm --filter @handshake-agent/api dev`, web on :3000, log in, send "show my transactions this month" → list card + working "Download statement (PDF)".

## Self-review notes (addressed)

- **Spec coverage:** §1 intent → Task 2/12; §2 resolver → Task 5; §3 service + repo → Task 9/10; §4 contracts → Task 3; §5 endpoints + token → Task 6/11; §6 generator → Task 7/8; §7 routing → Task 13/14; §8 FE → Task 16; §9 config → Task 4; §10 testing → every task + Task 15.
- **§8 open risks resolved:** `pdfkit` chosen + installed (Task 1; `require` fallback noted in Task 8); `z.string().date()` confirmed on zod `^3.25.76`; reused `RECEIPT_SIGNING_KEY` env pattern for `STATEMENT_SIGNING_KEY` + added `PUBLIC_API_BASE_URL`; controllers placed in `ChatModule` (mirrors `TransactionStatusController`) with explicit ordering before `transactions/:id`; WhatsApp gate uses `requireActiveUser` (linked user, no KYC).
- **Type consistency:** `TransactionHistoryResponse` from Task 3 is the exact return of `TransactionHistoryService.query` (Task 10) and the `transactions` outcome (Task 3) and the `/history` endpoint (Task 11); `StatementModel` from Task 7 is consumed verbatim by Task 8 + Task 11; `listByUserInRange` signature is identical in Task 9's port, impl, and Task 10's call.
