# Transaction-History Query — Design

> Status: **approved** (2026-06-29) · Branch: `feat/web-agent-vertical` (worktree `trusting-khorana-970635`)
> Read order: root [`CLAUDE.md`](../../../CLAUDE.md) → [`api/CLAUDE.md`](../../../api/CLAUDE.md) → [`web/CLAUDE.md`](../../../web/CLAUDE.md) → [`docs/PRD.md`](../../PRD.md) §4 → this spec.

## 1. Goal

Let a user **ask the agent for their own transaction history** in natural language, on **both** surfaces
(web chat + WhatsApp), and **download a PDF statement** of the filtered set. Example utterances:

- "show my transactions today"
- "what did I send last week"
- "my transaction history"
- "transactions from June 1 to June 15"
- "download my statement"

The agent emits a **read-only query spec**; a deterministic server resolves the date window and reads the
existing `Transaction`/`Receipt` tables scoped to the authenticated user. **Nothing here moves money** — the
model-proposes/engine-disposes invariant (§3.1) is preserved by construction: this capability never reaches
`ProposalService`/`ExecutionService` and never mutates the ledger.

### Non-goals (explicitly deferred)

- **CSV / other formats** — PDF only for now. The generator sits behind a port so a format can be added later
  without touching callers.
- **In-thread WhatsApp document upload** (`sendDocument` + `/media`) — WhatsApp renders the list as text and
  hands off the file via a **signed link** (reusing `sendCtaUrl`). Native document delivery is a clean
  follow-up behind the same generator.
- **A standalone "full history" web page / pagination UI** — the chat card shows the first page (capped); the
  HTTP endpoint exists and is reusable, but no dedicated route/infinite-scroll is built now.
- **Per-asset running balances / analytics** in the statement — the statement is a labeled list of the
  in-window transactions, not an account-balance report.

## 2. Baseline (what already exists — reused as-is)

- **Intents** are a Zod `discriminatedUnion('action', …)` in `packages/contracts/src/intents/` (members:
  `buy_crypto | sell_crypto | send_crypto | receive_crypto | swap | buy_ticket | check_balance | none`). The
  agent emits one via `model.withStructuredOutput(IntentSchema)` in
  [`anthropic-llm.provider.ts`](../../../api/src/modules/agent/infrastructure/anthropic-llm.provider.ts). The
  agent core has **no DB access** — only the `LlmProvider` port (§3.2, depcruise-enforced).
- **Web chat**: `WebChatService.handleMessage` routes `intent.action` → an `AgentTurnOutcome`
  `discriminatedUnion('kind', …)` ([`chat.schemas.ts`](../../../packages/contracts/src/chat/chat.schemas.ts);
  members `clarification | needs_kyc | needs_beneficiary | receive | proposal | not_supported`). Controller
  `POST /chat/messages` behind `JwtAuthGuard` + `@CurrentUser()`.
- **WhatsApp**: `ConversationService.handleInbound` routes the same intents → text/Flow replies via
  `IWhatsAppSender` (`sendText`, `sendFlow`, `sendBeneficiaryFlow`, **`sendCtaUrl`**). No `sendDocument` today.
- **Data**: `Transaction` (`userId`, `type` ∈ `buy|sell|send|swap|ticket_purchase|reward|refund|deposit`,
  `status` ∈ `pending|validating|confirmed|settling|completed|failed|rolled_back|cancelled`, `metadata` JSON,
  `createdAt`) with a ready-made **`@@index([userId, status, createdAt])`**; `Receipt` (`receiptNumber`,
  `userId`, `@@index([userId, issuedAt])`). Reached only via ports: `TRANSACTION_REPOSITORY`,
  `SETTLEMENT_REPOSITORY` (`findReceiptNumber(transactionId)`), etc. Amounts live in `metadata` as **decimal
  strings** (`asset`, `cryptoAmount`, `fiatAmount`, `fiatCurrency`).
- **Asset registry**: `AssetRegistry.formatCrypto(symbol, amount)` → `"3.5 USDT"` and
  `AssetRegistry.formatFiat(code, amount)` → `"₦5,000.00"` (deterministic, ICU-independent).
- **Status endpoint** `GET /transactions/:id` ([`proposal.controller.ts`](../../../api/src/modules/chat/presentation/proposal.controller.ts))
  is the auth + ownership pattern to mirror: load by id, `throw NotFoundException` when
  `tx === null || tx.userId !== user.userId`, read amounts from `metadata`, `createdAt.toISOString()`.
- **`CLOCK`** token (`SystemClock`) supplies deterministic `now: Date`. Config is layered (JSON defaults → env
  → DB-admin) via `ConfigService` (§7).

## 3. Architecture overview

```
user text ──▶ Agent (LlmProvider) ──▶ Intent{action:'query_transactions', period?/from?/to?, txType?, download?}
                                          │  (read-only spec — no execution)
                          ┌───────────────┴───────────────┐
                   WebChatService                   ConversationService (WhatsApp)
                          │                                 │
                          ▼                                 ▼
                 TransactionHistoryService.query(userId, spec)         (read-only; ownership-scoped)
                    ├─ resolveWindow(spec, now)            (pure domain; WAT day boundaries)
                    ├─ TRANSACTION_REPOSITORY.listByUserInRange(...)   (uses userId+createdAt index)
                    └─ map → items (AssetRegistry formatting, status label, direction, receiptNumber)
                          │                                 │
            { kind:'transactions', window, items,    text list reply (sendText)
              totalCount, truncated, downloadUrl }   + signed downloadUrl (sendCtaUrl)
                          ▼
                   web TransactionHistoryCard (list + "Download statement (PDF)")

download:  GET /transactions/statement/download?token=…  (public, HMAC-signed token)
             └─ verify token → TransactionHistoryService.query → STATEMENT_GENERATOR.generate → stream PDF
```

**Key invariant checks** (Task Completion Checklist §14):
- Model output is a **query spec**, never acted on as a financial parameter; no proposal/engine call (§3.1). ✔
- Agent keeps **zero DB access** — only the `LlmProvider` port changes (a prompt line) (§3.2). ✔
- This is a **read-only** capability over the user's **own** data: the security boundary is **server-side
  `userId` scoping**, not the frontend. No KYC/PIN gate (§3.3 governs money-*moving* endpoints; this moves none).
  The signed download token is itself bound to a single `userId`. ✔
- All cross-boundary shapes come from `@handshake-agent/contracts` (§8). ✔

## 4. Component design

### 4.1 Intent — `packages/contracts/src/intents/query-transactions.intent.ts`

```ts
export const TransactionPeriodSchema = z.enum([
  'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'all',
])
export const TransactionTypeFilterSchema = z.enum(['buy', 'sell', 'send', 'receive', 'all'])

export const QueryTransactionsIntentSchema = z.object({
  action:   z.literal('query_transactions'),
  period:   TransactionPeriodSchema.optional(),
  from:     z.string().date().optional(),   // ISO YYYY-MM-DD — explicit ranges only
  to:       z.string().date().optional(),
  txType:   TransactionTypeFilterSchema.optional(),
  download: z.boolean().optional().default(false),
})
```

Added to `IntentSchema` in `intents/index.ts` (import + union member; the union stays a
`discriminatedUnion('action', …)`). `z.string().date()` is available on the pinned `zod@^3.25.x` — verify at
plan time; if absent, fall back to a `YYYY-MM-DD` regex `.refine`.

**System-prompt update** ([`anthropic-llm.provider.ts`](../../../api/src/modules/agent/infrastructure/anthropic-llm.provider.ts)):
add `query_transactions` to the action list and a rules block:
- Use it when the user asks to see / list / review their past transactions or history, or to download a
  statement.
- Choose a `period` enum for relative phrases ("today", "last week", "this month"). **Never compute calendar
  dates yourself.**
- Only emit `from`/`to` (ISO `YYYY-MM-DD`) for an **explicit** range the user states ("from June 1 to June 15").
- Set `txType` when the user names a direction ("what did I **send**" → `send`); else omit / `all`.
- Set `download: true` only when the user asks for a file/statement/PDF.

### 4.2 Date resolver — `api/src/modules/transactions/domain/statement-window.ts` (pure)

```ts
export interface StatementWindow { from: Date; to: Date; label: string }
export function resolveWindow(spec: QueryWindowSpec, now: Date, cfg: WindowConfig): StatementWindow
```

- Day boundaries computed in **WAT = fixed UTC+1, no DST** (config offset, default `+60` min) so "today" is the
  user's calendar day, not a UTC day (correct near midnight). Week = **Monday-start**.
- Precedence: explicit `from`/`to` **>** `period` **>** default (`all`).
- `period` semantics: `today`=[localMidnight, now]; `yesterday`=[prev local midnight, local midnight);
  `this_week`=[Mon 00:00 WAT, now]; `last_week`=[prev Mon, prev Sun 24:00); `this_month`=[1st 00:00 WAT, now];
  `last_month`=full previous calendar month; `all`=[`now − maxWindowDays`, now].
- Validation/clamps: `from ≤ to`; `to` clamped to `now` (reject future → clamp); window clamped to
  `maxWindowDays` (config, default 365) by moving `from` forward. Invalid explicit dates that survive Zod (e.g.
  `from > to`) → clamp to a safe default + a human `label` reflecting what was used.
- `label` is a human window description for the card / statement header (e.g. "Today", "Jun 1–15, 2026",
  "Last 30 days").

### 4.3 Read service — `api/src/modules/transactions/application/transaction-history.service.ts`

```ts
@Injectable()
export class TransactionHistoryService {
  constructor(
    @Inject(TRANSACTION_REPOSITORY) private readonly txRepo: ITransactionRepository,
    @Inject(SETTLEMENT_REPOSITORY)  private readonly settlementRepo: ISettlementRepository,
    private readonly assets: AssetRegistry,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: ConfigService, // window/row-cap config
  ) {}
  async query(userId: string, spec: QueryTransactionsSpec): Promise<TransactionHistoryResult>
}
```

- Resolve window via `resolveWindow`. Map `txType` → engine types: `buy→[buy]`, `sell→[sell]`, `send→[send]`,
  `receive→[deposit]`, `all`/undefined → all money-moving types `[buy, sell, send, deposit]` (excludes
  internal `reward|refund|rolled_back` noise unless found useful — start with the four).
- New **port method** on `ITransactionRepository` (+ Prisma impl) — the only addition to an existing port:

  ```ts
  listByUserInRange(input: {
    userId: string; from: Date; to: Date; types?: string[]; limit: number;
  }): Promise<{ rows: TransactionRecord[]; total: number }>
  ```

  One `$transaction` of two reads against `where: { userId, createdAt: { gte, lte }, type: { in } }`: the rows
  (`orderBy: { createdAt: 'desc' }`, `take: limit`) and the `count` (authoritative `total`), reusing
  `@@index([userId, status, createdAt])`. **All statuses** included (the chosen scope) — each row carries its
  `status` label.
- Map each `TransactionRecord` → display item: `direction` (`in` for `buy|deposit`, `out` for `sell|send`),
  formatted `cryptoAmount` (`AssetRegistry.formatCrypto`) and `fiatAmount` (`formatFiat`) from `metadata`,
  `status`, `createdAt` ISO, and `receiptNumber` for `completed` rows (`settlementRepo.findReceiptNumber`).
- **Cap** at `rowCap` (config, default 100): call `listByUserInRange` with `limit = rowCap`. `items` = the
  returned `rows` (mapped); `totalCount` = the port's authoritative `total` (exact count); `truncated =
  total > rows.length`. Truncation is **surfaced**, never silent (§13).
- Build a signed `downloadUrl` (see 4.5) from the resolved window + `txType`.

### 4.4 Contracts — response + outcome member

`packages/contracts/src/transactions/transaction-history.schema.ts` (new):

```ts
export const TransactionHistoryItemSchema = z.object({
  id: z.string(), type: z.string(), status: z.string(),
  direction: z.enum(['in', 'out']),
  asset: z.string().optional(), cryptoAmount: z.string().optional(),   // formatted display strings
  fiatAmount: z.string().optional(), fiatCurrency: z.string().optional(),
  createdAt: z.string(), receiptNumber: z.string().optional(),
})
export const TransactionWindowSchema = z.object({ from: z.string(), to: z.string(), label: z.string() })
export const TransactionHistoryResponseSchema = z.object({
  window: TransactionWindowSchema,
  items: z.array(TransactionHistoryItemSchema),
  totalCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  downloadUrl: z.string(),
})
```

New `AgentTurnOutcome` member in [`chat.schemas.ts`](../../../packages/contracts/src/chat/chat.schemas.ts):

```ts
z.object({ kind: z.literal('transactions') }).merge(TransactionHistoryResponseSchema)
// → { kind:'transactions', window, items, totalCount, truncated, downloadUrl }
```

### 4.5 Endpoints (NestJS, mirror `GET /transactions/:id`)

Both live in a `TransactionHistoryController` (presentation; the transactions module currently has no
presentation layer — co-locate next to the chat module's `proposal.controller.ts` pattern, wherever DI is
cleanest; decide at plan time).

1. **`GET /transactions/history?period=&from=&to=&txType=`** — `@UseGuards(JwtAuthGuard)`, `@CurrentUser()`.
   Parses query → `QueryTransactionsSpec`, calls `TransactionHistoryService.query(user.userId, spec)`, returns
   `TransactionHistoryResponse`. Ownership is implicit (uses the JWT user's id). Reused by the web chat card and
   any future history page.

2. **`GET /transactions/statement/download?token=`** — **public** (no `JwtAuthGuard`), validates a signed
   token. The token is the only authorization, so a mobile browser opened from a WhatsApp link works. Flow:
   verify HMAC + `exp` → reconstruct `{userId, from, to, txType}` → `service.query` →
   `STATEMENT_GENERATOR.generate` → stream with `Content-Type: application/pdf` and
   `Content-Disposition: attachment; filename="handshake-statement-<from>_<to>.pdf"`. Invalid/expired/tampered
   token → `401`/`403` (no data leak).

**Signed token** — `api/src/modules/transactions/application/statement-token.service.ts` (pure-ish, testable):
`sign({userId, from, to, txType, exp}) → "base64url(json).hexHmac"`; `verify(token) → payload | throws`. HMAC-
SHA256 with `STATEMENT_SIGNING_KEY` (env secret, §7). TTL config (default 900s). The **same** signed
`downloadUrl` (absolute, built from a configured public API base URL) is embedded in the web outcome **and**
sent on WhatsApp — one mechanism, both surfaces.

### 4.6 Statement generator — port + PDF impl

`api/src/modules/transactions/application/ports/statement-generator.port.ts`:

```ts
export const STATEMENT_GENERATOR = Symbol('STATEMENT_GENERATOR')
export interface StatementFile { buffer: Buffer; contentType: string; filename: string }
export interface IStatementGenerator { generate(model: StatementModel): Promise<StatementFile> }
```

- `StatementModel` is built by a **pure** `buildStatementModel(items, window, account)` (heavily unit-tested):
  header (brand, window label, generated-at), the row list, and footer counts. Account = a minimal display
  identity (e.g. masked email / user id), **no secrets**.
- `PdfStatementGenerator` (infrastructure) implements the port with **`pdfkit`** (built-in Helvetica, CJS-safe
  under Nest). Determinism: set `info.CreationDate` from `CLOCK` (not wall-clock) and a fixed producer string.
  Collect the stream chunks into a `Buffer`. Verify `pdfkit` is installable/typed at plan time; if it fights the
  toolchain, fall back to `pdf-lib`. The adapter test asserts a valid `%PDF-` buffer, `contentType`, and
  `filename`; the **data correctness** is covered by `buildStatementModel` tests.

### 4.7 Routing

- **Web** — `WebChatService`: add a `case 'query_transactions'` →
  `const r = await this.history.query(user.userId, spec)` → outcome `{ kind:'transactions', ...r }`. Persist the
  reply summary text (e.g. "Found N transactions for <label>.") like other branches.
- **WhatsApp** — `ConversationService`: add `case 'query_transactions'` → `handleTransactionHistory`:
  - Require a **linked active user** (read-only own data). If unlinked contact → reply "Please sign in on the
    web app to view your history." **No KYC/PIN gate** (nothing money-moving).
  - `service.query(user.id, spec)` → render up to N items as a **formatted text list** (date · type · signed
    amount · status) via `sendText`. Empty → "No transactions for <label>."
  - Always (and especially when `download`) send the signed `downloadUrl` via **`sendCtaUrl`**
    (`{ to, body:"Download your statement (PDF)", buttonText:"Download", url }`).

### 4.8 Frontend — `web/`

- `web/components/chat/TransactionHistoryCard.tsx` (`TransactionHistoryCardProps` in `web/types/`): renders
  `window.label`, the rows (date · type · signed amount with `in`/`out` color via status tokens, never color as
  sole signal — §13.8), `truncated` note ("showing latest N"), and a **"Download statement (PDF)"** button that
  opens `downloadUrl` (absolute, `target="_blank" rel="noopener"`; browser downloads via
  `Content-Disposition`). Four async branches honored — **empty** = "No transactions in this window."
- `web/lib/chat/…` chat-store: map the new `kind:'transactions'` outcome → a `ChatMessage` the thread renders
  with the card (new message kind or reuse the activity-card slot — pick the lighter-touch one at plan time).
- Vitest covers the card (empty/data/truncated, download href) and the store mapping.

## 5. Configuration (§7 layered)

| Value | Source | Default |
| --- | --- | --- |
| `STATEMENT_SIGNING_KEY` | **env** (secret) | — (boot-validated; required for the download endpoint) |
| Public API base URL (absolute download links) | env/config (reuse existing if present) | — |
| Statement link TTL (sec) | JSON default (admin-tunable later) | `900` |
| Max history window (days) | JSON default | `365` |
| Row cap (chat card + statement) | JSON default | `100` |
| WAT offset (minutes) | JSON default | `60` |

Reuse an existing public-base-URL/signing-key config if the WhatsApp/webhook layer already defines one (check at
plan time) rather than adding a parallel knob (§13.1).

## 6. Testing (strict TDD — red → green → refactor)

- **Contracts**: parse valid/invalid `QueryTransactionsIntent` and `TransactionHistoryResponse` fixtures;
  confirm the new intent joins the `action` union and the new outcome joins the `kind` union.
- **Domain `resolveWindow`**: every `period`; explicit ranges; `from > to` clamp; future-`to` clamp; window >
  max clamp; **WAT midnight edge** (a UTC instant that is "yesterday" in UTC but "today" in WAT resolves to
  today). Pure, exhaustive.
- **`buildStatementModel`**: row mapping, formatting, counts, empty set.
- **`StatementTokenService`**: sign→verify round-trip; tampered payload → reject; expired `exp` → reject;
  wrong key → reject.
- **`TransactionHistoryService`**: mocked `ITransactionRepository` + **real** `AssetRegistry`/config — filtering
  by type, direction mapping, amount formatting, truncation flag, receiptNumber attachment.
- **`PdfStatementGenerator`**: produces a `%PDF-` buffer, right content-type/filename.
- **e2e (Testcontainers, real Postgres)** in `api/test/`:
  - Seed a user + transactions across dates/types → `GET /transactions/history` (JWT) returns the right window
    + items; **another user's JWT → 404/empty** (ownership).
  - `GET /transactions/statement/download?token=<valid>` → `200` `application/pdf` (`%PDF-`); tampered/expired
    token → `401`/`403`.
  - **Chat e2e**: override the `LLM_PROVIDER` DI token with a stub returning a `query_transactions` intent →
    `POST /chat/messages` returns `{ kind:'transactions', … }` with a `downloadUrl`. (Avoids needing live
    Anthropic credits — mirrors how existing chat e2e stubs the agent.)
- **Frontend (Vitest)**: `TransactionHistoryCard` (empty/data/truncated, download href) + chat-store mapping.
- **`pnpm depcruise`** stays clean (agent core still imports no DB/Nest/Prisma).

## 7. Files touched / added (map)

**contracts** — `intents/query-transactions.intent.ts` (new), `intents/index.ts` (union),
`transactions/transaction-history.schema.ts` (new), `chat/chat.schemas.ts` (outcome member).

**api** —
`agent/infrastructure/anthropic-llm.provider.ts` (prompt),
`transactions/domain/statement-window.ts` (new),
`transactions/application/transaction-history.service.ts` (new),
`transactions/application/statement-token.service.ts` (new),
`transactions/application/ports/statement-generator.port.ts` (new),
`transactions/application/ports/transaction.repository.port.ts` (+`listByUserInRange`),
`transactions/infrastructure/transaction.prisma.repository.ts` (+impl),
`transactions/infrastructure/pdf-statement.generator.ts` (new),
`transactions/presentation/transaction-history.controller.ts` (new; 2 routes),
`transactions/transactions.module.ts` (providers/exports), config defaults JSON + env Zod schema,
`chat/application/web-chat.service.ts` (route),
`conversations/application/conversation.service.ts` (route + `handleTransactionHistory`).

**web** — `components/chat/TransactionHistoryCard.tsx` (new), `types/` props, chat-store outcome mapping,
`ChatMessage` render branch; Vitest specs.

## 8. Open risks / verify-at-plan-time

1. **`pdfkit` toolchain fit** — installs, types, CJS under Nest + ts-jest, deterministic `CreationDate`. Fallback
   `pdf-lib`. (Confirm before committing to the dependency.)
2. **`z.string().date()`** on the pinned zod — confirm; else regex `.refine`.
3. **Public base URL / signing-key reuse** — find any existing config the WhatsApp/webhook layer already
   exposes before adding new knobs.
4. **Presentation placement** — transactions module has no `presentation/` today; confirm cleanest DI home for
   the controller (transactions module vs. chat module, matching where `GET /transactions/:id` lives).
5. **WhatsApp "linked active user" gate** — confirm the exact helper (`requireActiveUser` returns
   `needsKyc`/`needsReverify`); history should pass for any linked active user without forcing KYC.
