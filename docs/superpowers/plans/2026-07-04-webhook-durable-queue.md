# Webhook Durable Queue + Console Replay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every task. Steps use checkbox (`- [ ]`) syntax for tracking. Strict Red → Green → Refactor.

**Goal:** Move every inbound webhook (Blockradar deposit/withdraw/swap, Flutterwave collection/payout, WhatsApp Cloud API) onto a durable, dedup-keyed, retrying queue with an audited admin replay console — without ever letting a webhook body move money directly (§3.1).

**Architecture:** Persist-first, process-async. On receipt each controller (1) verifies the provider signature exactly as today, (2) persists the raw payload+headers+signature+provider+receivedAt into a new `WebhookEvent` table (dedup on `(provider, providerEventId)`), (3) enqueues a BullMQ job on a new `webhook-processing` queue (best-effort — persistence is the source of truth), (4) ACKs 2xx immediately. A `WebhookProcessor` in the existing worker process (`worker.ts`) drains the queue, routes to a per-provider handler that runs the _existing_ idempotent settlement/ingest logic, and records lifecycle (`received → processing → succeeded | failed | dead`) with attempts + last error. BullMQ owns exponential backoff + attempt exhaustion; on exhaustion the row is marked `dead`. A `@Cron` sweeper re-enqueues rows stuck in `received` (covers a Redis-down enqueue miss). Admin reads/retries via `modules/admin` (permission + step-up + audit); retry only re-enqueues — settlement stays engine-brokered.

**Tech Stack:** NestJS 11 (`api/`), Prisma 7 split-schema, BullMQ 5 + ioredis (already installed), `@nestjs/schedule`, `@testcontainers/postgresql` + `@testcontainers/redis`, shared Zod (`packages/contracts`), Next 16 web-admin (TanStack Query + axios + vitest).

## Global Constraints (verbatim from repo rules)

- **§3.1 model-proposes/engine-disposes:** no webhook body moves money directly; the worker calls only the _existing_ idempotent `ExecutionService.*` / `settleDepositAtomic` / `WhatsAppInboundService.ingest`. Admin retry re-enqueues, never settles inline.
- **§3.2 agent no DB:** N/A here, but the clean-arch inward rule is enforced — `application` never imports `@prisma/client` / `generated/prisma` / `infrastructure`; only `infrastructure` repos import the generated client.
- **§3.5 WhatsApp official-API only:** unchanged — signature guard + Cloud-API payloads only.
- **§3.6 no shortcuts:** no placeholder impls, no hardcoded tunables — retry/backoff/sweeper params live in `configuration.ts` JSON defaults.
- **Contracts single source (§8):** every FE⇄BE shape is a Zod schema in `packages/contracts`, parsed at the boundary.
- **Prisma:** models use `@id @default(uuid(7)) @db.Uuid`, enums `@@map("snake_case")`, `@db.Timestamptz`. Only `infrastructure` repos import `../../../../generated/prisma/client`.
- **BullMQ split:** `@Processor` classes live ONLY in the worker graph (`worker.module.ts` → `worker.ts`), never in a module reachable from `AppModule` (else the API process opens Worker Redis connections and e2e-without-Redis breaks).
- **e2e-without-Redis:** enqueue is best-effort/caught; persistence + the 2xx ACK never depend on Redis being up.
- **Testing (§9):** unit specs (`*.spec.ts`, `rootDir: src`) + integration against real Postgres via Testcontainers; web-admin vitest for the page. Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm depcruise`.
- **Node:** worktree runs on Node 24 (LTS-range; depcruise OK). Commands are prefixed `corepack pnpm@10.25.0`.

---

## File Structure

**Prisma (new schema slice)**

- Create `api/prisma/schema/11-webhooks.prisma` — `WebhookEvent` model + `WebhookProvider` + `WebhookEventStatus` enums.
- Migration: `api/prisma/migrations/<ts>_add_webhook_events/migration.sql`.

**Contracts**

- Create `packages/contracts/src/admin/webhooks.dto.ts` — `WebhookProvider`, `WebhookEventStatus`, list query, list item, list response, detail, retry request, metrics.
- Create `packages/contracts/src/admin/webhooks.spec.ts` — schema fixtures.
- Modify `packages/contracts/src/index.ts` — export the new file.
- Modify `packages/contracts/src/admin/permissions.ts` — append webhook `api_route` + `web_page` + `menu_item` catalog entries (Ops category).

**api — webhooks module (`api/src/modules/webhooks/`)**

- `domain/webhook-provider.ts` — provider + status literals + `deriveWebhookEventId` (pure) + `terminalStatuses`.
- `domain/webhook-provider.spec.ts`.
- `application/ports/webhook-event.repository.port.ts` — `WEBHOOK_EVENT_REPOSITORY`, records, create-dedup, list, detail, lifecycle writes, counts.
- `application/ports/webhook-dispatch.port.ts` — `WEBHOOK_DISPATCH` (enqueue by webhookEventId).
- `application/ports/webhook-handler.port.ts` — `WebhookHandler` interface + `WEBHOOK_HANDLER_REGISTRY` token + `WebhookHandlerRegistry` type.
- `application/webhook-ingestion.service.ts` (+ `.spec.ts`) — persist(dedup) + best-effort enqueue.
- `application/webhook-processing.service.ts` (+ `.spec.ts`) — lifecycle orchestration around a resolved handler.
- `application/webhook-metrics.service.ts` (+ `.spec.ts`) — depth + failed/dead counts.
- `infrastructure/webhook-event.prisma.repository.ts` (+ `.spec.ts` integration, Testcontainers) — Prisma adapter.
- `infrastructure/bullmq-webhook-dispatch.adapter.ts` — `@InjectQueue(WEBHOOK_QUEUE_NAME)`.
- `infrastructure/webhook-queue.constants.ts` — `WEBHOOK_QUEUE_NAME`, `WEBHOOK_PROCESS_JOB`.
- `webhook-sweeper.service.ts` (+ `.spec.ts`) — `@Cron` re-enqueue of stuck `received` rows.
- `webhooks.module.ts` (+ `.spec.ts`) — producer module (imported by AppModule).

**api — worker side**

- `api/src/modules/webhooks/infrastructure/webhook.processor.ts` (+ `.spec.ts`) — `@Processor(WEBHOOK_QUEUE_NAME)`.
- `api/src/modules/webhooks/webhook-worker.module.ts` — worker-only; builds the handler registry, provides the processing service + processor. Imported by `worker.module.ts` only.

**api — provider handlers (settlement logic moved out of controllers)**

- `api/src/modules/wallets/application/blockradar-webhook.handler.ts` (+ `.spec.ts`) — deposit/withdraw/swap routing (moved from controller).
- `api/src/modules/treasury/application/flutterwave-webhook.handler.ts` (+ `.spec.ts`) — charge/transfer + legacy routing.
- `api/src/modules/whatsapp/application/whatsapp-webhook.handler.ts` (+ `.spec.ts`) — wraps `WhatsAppInboundService.ingest`.

**api — thin controllers (verify → ingest → ACK)**

- Modify `api/src/modules/wallets/presentation/blockradar-webhook.controller.ts` + `.spec.ts`.
- Modify `api/src/modules/treasury/presentation/flutterwave-webhook.controller.ts` + `.spec.ts`.
- Modify `api/src/modules/whatsapp/presentation/whatsapp-webhook.controller.ts` + `.spec.ts`.
- Modify the three webhook modules to import `WebhooksModule`: `blockradar-webhook.module.ts`, `flutterwave-webhook.module.ts`, `whatsapp.module.ts`.
- Modify `api/src/worker.module.ts` (import `WebhookWorkerModule`) and `api/src/app.module.ts` (import `WebhooksModule`).
- Modify `api/src/core/config/configuration.ts` (+ its type) — `webhooks` config block.
- Modify `api/src/core/jobs/jobs.module.ts` — register the `webhook-processing` queue (producer).

**api — admin console (reuse admin guards/audit)**

- `api/src/modules/admin/application/admin-webhooks.service.ts` (+ `.spec.ts`) — list/detail/retry (audit + re-enqueue).
- `api/src/modules/admin/presentation/admin-webhooks.controller.ts` (+ `.spec.ts`) — GET list, GET :id, POST :id/retry, GET metrics.
- `api/src/modules/admin/presentation/dto/admin-webhooks.dto.ts` — `createZodDto` wrappers.
- Modify `api/src/modules/admin/admin.module.ts` — import `WebhooksModule`, register controller + service.

**web-admin**

- `web-admin/lib/api/webhooks.ts` — list/detail/retry/metrics clients (Zod-parsed).
- `web-admin/lib/query/keys.ts` + `hooks.ts` — query keys + `useWebhooks`/`useWebhookDetail`/`useWebhookMetrics`/`useRetryWebhook`.
- `web-admin/app/webhooks/page.tsx` — route.
- `web-admin/components/admin/webhooks-page.tsx` — list + filters + detail drawer + retry (step-up).
- Modify `web-admin/components/admin/app-shell.tsx` (nav entry) + `web-admin/lib/route-access.ts` (`/webhooks`).
- `web-admin/__tests__/webhooks-page.test.tsx` — vitest.

---

## Phase A — Contracts + schema foundation

### Task 1: `WebhookEvent` Prisma model + migration

**Files:** Create `api/prisma/schema/11-webhooks.prisma`; generate migration.

**Interfaces — Produces:** table `webhook_events`; enums `webhook_provider` (`blockradar|flutterwave|whatsapp`), `webhook_event_status` (`received|processing|succeeded|failed|dead`).

- [ ] **Step 1 — write the model.** Create `api/prisma/schema/11-webhooks.prisma`:

```prisma
/// Durable record of every inbound provider webhook (Track A — go-readiness).
/// Persist-first, process-async: the row is written BEFORE the 2xx ACK, then a
/// BullMQ worker drains it. Dedup on (provider, providerEventId) — a redelivery
/// finds the existing row and never re-processes a succeeded one (§3.1: never
/// double-credit). The raw payload/headers/signature are kept verbatim for replay
/// + audit. Money never moves from here — the worker calls the existing idempotent
/// engine paths; admin retry only re-enqueues.
model WebhookEvent {
  id              String             @id @default(uuid(7)) @db.Uuid
  provider        WebhookProvider
  /// Provider's event id (Blockradar data.id / Flutterwave data.id / WhatsApp wamid);
  /// falls back to sha256(rawBody) when the provider gives no natural id.
  providerEventId String
  /// Verbatim request body bytes (as received, pre-parse) — the replay source.
  payload         Json
  /// Captured request headers (lowercased keys) for audit + replay.
  headers         Json
  /// The provider signature header value (audit; never re-verified from here).
  signature       String?
  status          WebhookEventStatus @default(received)
  attempts        Int                @default(0)
  lastError       String?
  receivedAt      DateTime           @default(now()) @db.Timestamptz
  lastAttemptAt   DateTime?          @db.Timestamptz
  processedAt     DateTime?          @db.Timestamptz
  deadAt          DateTime?          @db.Timestamptz
  createdAt       DateTime           @default(now()) @db.Timestamptz
  updatedAt       DateTime           @updatedAt @db.Timestamptz

  @@unique([provider, providerEventId])
  @@index([status, receivedAt])
  @@index([provider, status, receivedAt])
  @@map("webhook_events")
}

enum WebhookProvider {
  blockradar
  flutterwave
  whatsapp

  @@map("webhook_provider")
}

enum WebhookEventStatus {
  received
  processing
  succeeded
  failed
  dead

  @@map("webhook_event_status")
}
```

- [ ] **Step 2 — create the migration.** Run:
      `corepack pnpm@10.25.0 --filter @handshake-agent/api exec prisma migrate dev --name add_webhook_events`
      Expected: a new migration dir + regenerated client; no drift.

- [ ] **Step 3 — verify generate.** Run `corepack pnpm@10.25.0 --filter @handshake-agent/api exec prisma generate`. Expected: `WebhookEvent`, `WebhookProvider`, `WebhookEventStatus` in `api/generated/prisma/client`.

- [ ] **Step 4 — commit.** `feat(api): WebhookEvent durable-webhook table + enums`.

### Task 2: Contracts — webhook DTOs + permission catalog

**Files:** Create `packages/contracts/src/admin/webhooks.dto.ts` + `.spec.ts`; modify `index.ts`, `permissions.ts`.

**Interfaces — Produces:** `WebhookProviderSchema`, `WebhookEventStatusSchema`, `WebhookListQuerySchema`, `WebhookListItemSchema`, `WebhookListResponseSchema`, `WebhookDetailSchema`, `WebhookRetryRequestSchema`, `WebhookMetricsSchema` + inferred types.

- [ ] **Step 1 — failing test** (`webhooks.spec.ts`): parse a valid list item, a valid retry request `{ reason: "redeliver" }`, reject an unknown provider, reject empty `reason`.

- [ ] **Step 2 — run** `corepack pnpm@10.25.0 --filter @handshake-agent/contracts test` → FAIL (module missing).

- [ ] **Step 3 — implement `webhooks.dto.ts`:**

```ts
import { z } from "zod";

export const WebhookProviderSchema = z.enum([
  "blockradar",
  "flutterwave",
  "whatsapp",
]);
export type WebhookProvider = z.infer<typeof WebhookProviderSchema>;

export const WebhookEventStatusSchema = z.enum([
  "received",
  "processing",
  "succeeded",
  "failed",
  "dead",
]);
export type WebhookEventStatus = z.infer<typeof WebhookEventStatusSchema>;

export const WebhookListQuerySchema = z.object({
  provider: WebhookProviderSchema.optional(),
  status: WebhookEventStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type WebhookListQuery = z.infer<typeof WebhookListQuerySchema>;

export const WebhookListItemSchema = z.object({
  id: z.string(),
  provider: WebhookProviderSchema,
  providerEventId: z.string(),
  status: WebhookEventStatusSchema,
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  receivedAt: z.string(),
  processedAt: z.string().nullable(),
});
export type WebhookListItem = z.infer<typeof WebhookListItemSchema>;

export const WebhookListResponseSchema = z.object({
  items: z.array(WebhookListItemSchema),
  nextCursor: z.string().nullable(),
});
export type WebhookListResponse = z.infer<typeof WebhookListResponseSchema>;

export const WebhookDetailSchema = WebhookListItemSchema.extend({
  payload: z.unknown(),
  headers: z.record(z.string(), z.unknown()),
  signature: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  deadAt: z.string().nullable(),
});
export type WebhookDetail = z.infer<typeof WebhookDetailSchema>;

export const WebhookRetryRequestSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type WebhookRetryRequest = z.infer<typeof WebhookRetryRequestSchema>;

// Queue-depth + failed reads for the (later) metrics dashboard (requirement 5).
export const WebhookMetricsSchema = z.object({
  byStatus: z.record(WebhookEventStatusSchema, z.number().int()),
  depth: z.number().int(), // received + processing
  failed: z.number().int(), // failed
  dead: z.number().int(), // dead
});
export type WebhookMetrics = z.infer<typeof WebhookMetricsSchema>;
```

- [ ] **Step 4 — export** from `index.ts`: `export * from "./admin/webhooks.dto";`.

- [ ] **Step 5 — permission catalog.** Append to `PERMISSION_CATALOG` in `permissions.ts` (Ops category — `ops` role already has `Ops: [read, execute]`):

```ts
// Webhooks — durable inbound-webhook console (Track A). List/detail are reads;
// retry re-enqueues (execute, engine-brokered — never a raw money movement, §3.1).
r("api_route", "GET /admin/webhooks", "read", "Ops", "List recorded inbound webhooks"),
r("api_route", "GET /admin/webhooks/metrics", "read", "Ops", "Read webhook queue-depth + failed counts"),
r("api_route", "GET /admin/webhooks/:id", "read", "Ops", "View a recorded webhook (payload/headers/attempts/error)"),
r("api_route", "POST /admin/webhooks/:id/retry", "execute", "Ops", "Re-enqueue a webhook for processing (engine-brokered; moves no money)"),
r("web_page", "/admin/webhooks", "read", "Ops", "Webhooks console page"),
r("menu_item", "menu.webhooks", "read", "Ops", "Webhooks nav group"),
```

- [ ] **Step 6 — run** contracts + permissions specs → PASS. **Commit** `feat(contracts): webhook DTOs + Ops permission catalog entries`.

---

## Phase B — Persistence (repository, Testcontainers)

### Task 3: Domain helpers — provider/status + `deriveWebhookEventId`

**Files:** Create `domain/webhook-provider.ts` + `.spec.ts`.

**Interfaces — Produces:**

- `WEBHOOK_PROVIDERS`, `WEBHOOK_EVENT_STATUSES` const tuples (mirror the enums).
- `TERMINAL_WEBHOOK_STATUSES = new Set(["succeeded","dead"])`.
- `deriveWebhookEventId(provider, parsedBody: unknown, rawBody: Buffer | string): string` — provider-aware natural id with `sha256(rawBody)` fallback (uses `sha256Hex` from `core/crypto/hmac`).

- [ ] **Step 1 — failing spec:** blockradar `{ data: { id: "wh_1" } }` → `"wh_1"`; flutterwave `{ data: { id: 42 } }` → `"42"`; whatsapp first message id `{ entry:[{ changes:[{ value:{ messages:[{ id:"wamid.X" }] } }] }] }` → `"wamid.X"`; missing natural id → `sha256Hex(rawBody)`.

- [ ] **Step 2 — run** `... --filter @handshake-agent/api test -- webhook-provider` → FAIL.

- [ ] **Step 3 — implement** the pure helper. Guard every access with `typeof`/`Array.isArray`; coerce numbers with `String()`; fallback `return sha256Hex(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"))`.

- [ ] **Step 4 — run** → PASS. **Commit** `feat(api): webhook provider domain helpers + deriveWebhookEventId`.

### Task 4: `WEBHOOK_EVENT_REPOSITORY` port

**Files:** Create `application/ports/webhook-event.repository.port.ts`.

**Interfaces — Produces:**

```ts
export const WEBHOOK_EVENT_REPOSITORY = Symbol("WEBHOOK_EVENT_REPOSITORY");

export interface CreateWebhookEventData {
  provider: string;
  providerEventId: string;
  payload: Record<string, unknown> | unknown;
  headers: Record<string, unknown>;
  signature?: string | null;
}
export interface WebhookEventRecord {
  id: string;
  provider: string;
  providerEventId: string;
  payload: unknown;
  headers: Record<string, unknown>;
  signature: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  receivedAt: Date;
  lastAttemptAt: Date | null;
  processedAt: Date | null;
  deadAt: Date | null;
}
export interface WebhookListFilter {
  provider?: string;
  status?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}
export interface WebhookListPage {
  items: WebhookEventRecord[];
  nextCursor: string | null;
}

export interface IWebhookEventRepository {
  /** Insert; on (provider,providerEventId) conflict return { record, duplicate:true }. */
  createIfNew(
    data: CreateWebhookEventData,
  ): Promise<{ record: WebhookEventRecord; duplicate: boolean }>;
  findById(id: string): Promise<WebhookEventRecord | null>;
  list(filter: WebhookListFilter): Promise<WebhookListPage>;
  markProcessing(id: string): Promise<void>; // status→processing, attempts++, lastAttemptAt=now
  markSucceeded(id: string): Promise<void>; // status→succeeded, processedAt=now, lastError=null
  markFailed(id: string, error: string): Promise<void>; // status→failed, lastError
  markDead(id: string, error: string): Promise<void>; // status→dead, deadAt=now, lastError
  /** Admin/sweeper re-arm: status→received, clears deadAt (keeps attempts + lastError for history). */
  resetToReceived(id: string): Promise<void>;
  /** Rows stuck in `received` older than the grace window (sweeper). */
  findStuckReceived(
    olderThanSec: number,
    limit: number,
  ): Promise<WebhookEventRecord[]>;
  countByStatus(): Promise<Record<string, number>>;
}
```

- [ ] **Step 1 — write the port file** (interface only; no test — validated via the adapter integration test). **Commit** with Task 5.

### Task 5: `WebhookEventPrismaRepository` (integration, Testcontainers)

**Files:** Create `infrastructure/webhook-event.prisma.repository.ts` + `.spec.ts`.

**Interfaces — Consumes:** `IWebhookEventRepository`, generated `PrismaClient`, `WebhookProvider`/`WebhookEventStatus` enums.

- [ ] **Step 1 — failing integration spec** (mirror `settlement-outbox.prisma.repository.spec.ts` Testcontainers bootstrap). Cases:
  1. `createIfNew` inserts, returns `duplicate:false`; a second call with the same `(provider, providerEventId)` returns `duplicate:true` and the SAME row id (no throw).
  2. `markProcessing` sets status=`processing`, increments `attempts` (0→1), sets `lastAttemptAt`.
  3. `markSucceeded` → status=`succeeded`, `processedAt` set, `lastError` null.
  4. `markFailed("boom")` → status=`failed`, `lastError="boom"`.
  5. `markDead("exhausted")` → status=`dead`, `deadAt` set.
  6. `resetToReceived` → status=`received`, `deadAt` null, `attempts` preserved.
  7. `list({ provider:"blockradar", limit:10 })` filters + keyset-paginates on `(receivedAt desc, id desc)`; `nextCursor` round-trips.
  8. `findStuckReceived(0, 10)` returns the `received` row; a `succeeded` row is excluded.
  9. `countByStatus` returns `{ received: n, ... }`.

- [ ] **Step 2 — run** → FAIL (adapter missing).

- [ ] **Step 3 — implement** the adapter. `createIfNew` uses `prisma.webhookEvent.create` inside a `try/catch` on Prisma `P2002` (unique violation) → fall back to `findUnique({ where: { provider_providerEventId: { provider, providerEventId } } })` and return `duplicate:true`. Cast `payload`/`headers` JSON with `as never` at the boundary; cast enum strings `as WebhookProvider`/`as WebhookEventStatus`. Keyset cursor = base64 of `${receivedAt.toISOString()}|${id}`.

- [ ] **Step 4 — run** → PASS. **Commit** `feat(api): WebhookEvent Prisma repository (dedup + lifecycle + keyset list)`.

---

## Phase C — Ingestion + dispatch (producer side)

### Task 6: `WEBHOOK_DISPATCH` port + BullMQ adapter + queue constants

**Files:** Create `application/ports/webhook-dispatch.port.ts`, `infrastructure/webhook-queue.constants.ts`, `infrastructure/bullmq-webhook-dispatch.adapter.ts`.

**Interfaces — Produces:**

```ts
// webhook-queue.constants.ts
export const WEBHOOK_QUEUE_NAME = "webhook-processing";
export const WEBHOOK_PROCESS_JOB = "process-webhook";

// webhook-dispatch.port.ts
export const WEBHOOK_DISPATCH = Symbol("WEBHOOK_DISPATCH");
export interface IWebhookDispatch {
  /** Enqueue processing for a persisted WebhookEvent. jobId = webhookEventId (dedup). */
  enqueue(webhookEventId: string): Promise<void>;
}
```

- [ ] **Step 1 — implement the adapter** (thin, mirrors `bullmq-job-queue.adapter.ts`): `@InjectQueue(WEBHOOK_QUEUE_NAME)`; `enqueue(id)` → `queue.add(WEBHOOK_PROCESS_JOB, { webhookEventId: id }, { jobId: id, attempts: cfg.maxAttempts, backoff: { type: "exponential", delay: cfg.backoffMs } })`. Read `attempts`/`backoffMs` from injected `EffectiveConfigService.get('webhooks')`. No unit test (thin infra; exercised in processor/e2e). **Commit** with Task 8.

### Task 7: `webhooks` config block

**Files:** Modify `api/src/core/config/configuration.ts` (+ its exported type).

- [ ] **Step 1 — add** to the config default object + a `WebhooksConfig` type:

```ts
webhooks: {
  maxAttempts: 5,
  backoffMs: 2_000,
  sweepGracePeriodSec: 60,
  sweepBatchSize: 50,
},
```

Type: `export interface WebhooksConfig { maxAttempts: number; backoffMs: number; sweepGracePeriodSec: number; sweepBatchSize: number; }`.

- [ ] **Step 2 — run** `... --filter @handshake-agent/api test -- configuration` (if a config spec exists) or typecheck. **Commit** `feat(api): webhooks retry/backoff/sweeper config defaults`.

### Task 8: `WebhookIngestionService` (persist-first + best-effort enqueue)

**Files:** Create `application/webhook-ingestion.service.ts` + `.spec.ts`.

**Interfaces — Produces:**

```ts
export interface IngestWebhookInput {
  provider: string; // "blockradar" | "flutterwave" | "whatsapp"
  parsedBody: unknown; // for deriveWebhookEventId
  rawBody: Buffer | string; // stored verbatim + sha256 fallback id
  headers: Record<string, unknown>;
  signature?: string | null;
}
export interface IngestResult {
  id: string;
  duplicate: boolean;
}

@Injectable()
export class WebhookIngestionService {
  async ingest(input: IngestWebhookInput): Promise<IngestResult>;
}
```

- [ ] **Step 1 — failing spec** (fakes for `IWebhookEventRepository` + `IWebhookDispatch`):
  1. New event → `createIfNew` called with the derived id + stored payload/headers/signature; `dispatch.enqueue(id)` called once; returns `{ duplicate:false }`.
  2. Duplicate event → `createIfNew` returns `duplicate:true` → `dispatch.enqueue` is **NOT** called (or is safely idempotent); returns `{ duplicate:true }`. (Choose: skip enqueue on duplicate.)
  3. **Redis-down / enqueue throws** → the method still resolves `{ duplicate:false }` (best-effort; error caught + logged) — persistence already durable, sweeper will re-enqueue.
  4. **Persist throws** → the error PROPAGATES (caller returns 5xx so the provider retries — nothing durable recorded yet).

- [ ] **Step 2 — run** → FAIL.

- [ ] **Step 3 — implement.** `deriveWebhookEventId` → `createIfNew` (let its throw propagate) → if `!duplicate` wrap `dispatch.enqueue(id)` in try/catch(log). Store `payload` as the parsed JSON object (or `{ raw: string }` if the body was non-JSON — payload column is `Json`).

- [ ] **Step 4 — run** → PASS. **Commit** `feat(api): WebhookIngestionService — persist-first, best-effort enqueue`.

---

## Phase D — Processing (worker side)

### Task 9: `WebhookHandler` port + registry token

**Files:** Create `application/ports/webhook-handler.port.ts`.

**Interfaces — Produces:**

```ts
import type { WebhookEventRecord } from "./webhook-event.repository.port";
export interface WebhookHandler {
  readonly provider: string; // "blockradar" | ...
  handle(event: WebhookEventRecord): Promise<void>; // throws to trigger retry
}
export const WEBHOOK_HANDLER_REGISTRY = Symbol("WEBHOOK_HANDLER_REGISTRY");
export type WebhookHandlerRegistry = Map<string, WebhookHandler>;
```

- [ ] **Step 1 — write the file.** **Commit** with Task 10.

### Task 10: `WebhookProcessingService` (lifecycle orchestration)

**Files:** Create `application/webhook-processing.service.ts` + `.spec.ts`.

**Interfaces — Consumes:** `WEBHOOK_EVENT_REPOSITORY`, `WEBHOOK_HANDLER_REGISTRY`.
**Produces:** `process(webhookEventId: string): Promise<void>` and `handleExhausted(webhookEventId, error): Promise<void>`.

- [ ] **Step 1 — failing spec** (fake repo + a registry with a stub handler):
  1. Happy path: `process(id)` → `findById` → status not terminal → `markProcessing` → `handler.handle(record)` → `markSucceeded`.
  2. Already `succeeded` → returns early, handler NOT called, no re-mark (dedup on re-delivery / double-enqueue).
  3. Handler throws → `markFailed(id, err.message)` is called AND `process` **re-throws** (so BullMQ counts the attempt + schedules backoff).
  4. Unknown provider (no handler in registry) → `markFailed(id, "no handler for <provider>")` + throw.
  5. `handleExhausted(id, err)` → `markDead(id, err.message)` (called by the processor's final-attempt event).

- [ ] **Step 2 — run** → FAIL.

- [ ] **Step 3 — implement.** Guard: `if (TERMINAL_WEBHOOK_STATUSES.has(record.status)) return;`. `markProcessing` before `handle`. On throw: `markFailed` then `throw`. Provide a separate `handleExhausted` used by the processor's `OnWorkerEvent('failed')` final-attempt branch.

- [ ] **Step 4 — run** → PASS. **Commit** `feat(api): WebhookProcessingService — dedup + lifecycle + retry surface`.

### Task 11: `WebhookProcessor` (`@Processor`, worker-only)

**Files:** Create `infrastructure/webhook.processor.ts` + `.spec.ts`.

- [ ] **Step 1 — failing spec:** `process({ name: WEBHOOK_PROCESS_JOB, data: { webhookEventId: "x" } })` delegates to `WebhookProcessingService.process("x")`; `onFailed(job, err)` on the final attempt (`attemptsMade >= opts.attempts - 1`) calls `processingService.handleExhausted("x", err)`; a non-final failure does NOT.

- [ ] **Step 2 — run** → FAIL.

- [ ] **Step 3 — implement** (mirror `ProvisionUserProcessor`): extends `WorkerHost`; `@Processor(WEBHOOK_QUEUE_NAME)`; `process()` reads `job.data.webhookEventId`; `@OnWorkerEvent('failed')` gates on the final attempt then calls `handleExhausted`.

- [ ] **Step 4 — run** → PASS. **Commit** `feat(api): WebhookProcessor — BullMQ consumer + dead-letter on exhaustion`.

### Task 12: `WebhookSweeperService` (`@Cron` re-enqueue fallback)

**Files:** Create `webhook-sweeper.service.ts` + `.spec.ts`.

- [ ] **Step 1 — failing spec:** `tick()` loads `findStuckReceived(grace, batch)` → for each calls `dispatch.enqueue(id)`; a re-entrancy flag skips overlapping ticks; one enqueue throw does not abort the batch.

- [ ] **Step 2 — run** → FAIL.

- [ ] **Step 3 — implement** (mirror `SettlementReconciliationService`): `@Cron('*/2 * * * *', { name: 'webhook-sweeper' })`, `isRunning` guard, per-row try/catch, grace + batch from `webhooks` config.

- [ ] **Step 4 — run** → PASS. **Commit** `feat(api): WebhookSweeperService — re-enqueue stuck received rows`.

---

## Phase E — Provider handlers (move settlement out of controllers)

> Each handler is a straight lift of the controller's current private routing/settlement/notify methods into an `application`-layer service, operating on `event.payload` instead of `@Body()`. The engine calls are unchanged (idempotent). Handlers throw on a genuine settlement failure so BullMQ retries; deliberate non-credit acks (wallet-not-found, unsupported asset, unhandled event) return normally (success).

### Task 13: `BlockradarWebhookHandler`

**Files:** Create `api/src/modules/wallets/application/blockradar-webhook.handler.ts` + `.spec.ts`. Consumes the same deps the controller had (`WALLET_REPOSITORY`, `DEPOSIT_SETTLEMENT_REPOSITORY`, `IdentityService`, `WHATSAPP_SENDER`, `AssetRegistry`, `ExecutionService`).

- [ ] **Step 1 — failing spec** (port the existing `blockradar-webhook.controller.spec.ts` cases to the handler): deposit.success credits + receipt; duplicate txHash no double-credit; **settlement throw RE-THROWS** (was 503 → now a retryable throw); wallet-not-found / network-mismatch / unsupported-asset return normally (ack); withdraw.success/failed → `settleSendOnChain`; swap.success/failed → `settleSwap`; unhandled event returns normally.

- [ ] **Step 2 — run** → FAIL.

- [ ] **Step 3 — implement:** `provider = "blockradar"`; `handle(event)` reads `event.payload as BlockradarWebhookBody`, runs the existing routing (`deposit.success`/`withdraw.*`/`swap.*`). Replace the deposit `ServiceUnavailableException` with a plain `throw new Error("deposit settlement failed")` (BullMQ retries). Keep the best-effort receipt sends (swallow their own errors).

- [ ] **Step 4 — run** → PASS. **Commit** `refactor(api): extract BlockradarWebhookHandler (settlement moved off controller)`.

### Task 14: `FlutterwaveWebhookHandler`

**Files:** Create `api/src/modules/treasury/application/flutterwave-webhook.handler.ts` + `.spec.ts`. Consumes `ExecutionService`, `IdentityService`, `WHATSAPP_SENDER`.

- [ ] **Step 1 — failing spec** (port `flutterwave-webhook.controller.spec.ts`): charge.completed→`settleBuyPayment`; transfer.completed SUCCESSFUL/FAILED→`settleSellPayout`; legacy flat collection/transfer; unhandled event returns normally; a settle throw re-throws (retryable).

- [ ] **Step 2 — run** → FAIL. **Step 3 — implement** (lift the private methods; the signature step stays in the controller). **Step 4 — run** → PASS. **Commit** `refactor(api): extract FlutterwaveWebhookHandler`.

### Task 15: `WhatsAppWebhookHandler`

**Files:** Create `api/src/modules/whatsapp/application/whatsapp-webhook.handler.ts` + `.spec.ts`. Consumes `WhatsAppInboundService`.

- [ ] **Step 1 — failing spec:** valid inbound payload → `WhatsAppInboundSchema.safeParse` → `inboundService.ingest(parsed.data)`; schema-invalid payload returns normally (no throw — matches current ack behavior); an `ingest` throw re-throws (retryable).

- [ ] **Step 2 — run** → FAIL. **Step 3 — implement:** `provider = "whatsapp"`; `handle(event)` parses `event.payload` with `WhatsAppInboundSchema`, delegates to `ingest`. **Step 4 — run** → PASS. **Commit** `refactor(api): extract WhatsAppWebhookHandler`.

---

## Phase F — Thin controllers + module wiring

### Task 16: `WebhooksModule` (producer) + queue registration

**Files:** Create `webhooks.module.ts` + `.spec.ts`; modify `jobs.module.ts`, `app.module.ts`.

- [ ] **Step 1 — module spec:** `Test.createTestingModule({ imports: [WebhooksModule] })` compiles; `WebhookIngestionService`, `WEBHOOK_EVENT_REPOSITORY`, `WEBHOOK_DISPATCH` resolve.
- [ ] **Step 2 — implement `WebhooksModule`:** `imports: [PrismaModule, BullModule.registerQueue({ name: WEBHOOK_QUEUE_NAME })]`; providers bind the repo, the dispatch adapter, the ingestion service, the metrics service, the sweeper; `exports: [WebhookIngestionService, WEBHOOK_EVENT_REPOSITORY, WEBHOOK_DISPATCH, WebhookMetricsService]`. NO `@Processor` here.
- [ ] **Step 3 — register** `WEBHOOK_QUEUE_NAME` in `jobs.module.ts` (mirror wallet-backfill line 101) and import `WebhooksModule` in `app.module.ts`.
- [ ] **Step 4 — run** module spec + `typecheck` → PASS. **Commit** `feat(api): WebhooksModule (producer) + register webhook-processing queue`.

### Task 17: `WebhookWorkerModule` (consumer) + worker wiring

**Files:** Create `webhook-worker.module.ts`; modify `worker.module.ts`.

- [ ] **Step 1 — implement `WebhookWorkerModule`:** `imports: [WebhooksModule, WalletsModule/BlockradarWebhookModule, FlutterwaveWebhookModule, WhatsAppModule, BullModule.registerQueue({ name: WEBHOOK_QUEUE_NAME })]`; providers: the three handler classes, a `{ provide: WEBHOOK_HANDLER_REGISTRY, useFactory: (b,f,w) => new Map([[b.provider,b],[f.provider,f],[w.provider,w]]), inject: [BlockradarWebhookHandler, FlutterwaveWebhookHandler, WhatsAppWebhookHandler] }`, `WebhookProcessingService`, `WebhookProcessor`.
- [ ] **Step 2 — import** `WebhookWorkerModule` in `worker.module.ts`.
- [ ] **Step 3 — verify** `worker.module.ts` still compiles and `AppModule` does NOT transitively import `WebhookWorkerModule` (depcruise). **Run** `depcruise`. **Commit** `feat(api): WebhookWorkerModule — processor + handler registry (worker-only)`.

### Task 18: Thin the three controllers + import `WebhooksModule`

**Files:** Modify the 3 controllers + `.spec.ts` + their 3 modules.

- [ ] **Step 1 — rewrite the controller specs** to the new contract: signature-verify unchanged (401 on bad sig); on valid sig → `ingestion.ingest({...})` called with `{ provider, parsedBody, rawBody, headers, signature }`; returns the provider's ACK shape (`{ status:'ok' }` / `{ status:'received' }`); a persist throw → 5xx (Blockradar/Flutterwave) so the provider retries; enqueue/best-effort never affects the ACK. Remove the old inline-settlement assertions (now covered by the handler specs).
- [ ] **Step 2 — run** → FAIL.
- [ ] **Step 3 — implement:** delete the private settlement/notify methods; inject `WebhookIngestionService`; keep `verifySignature` (Blockradar) / `paymentProvider.verifyWebhookSignature` (Flutterwave) / `WhatsAppSignatureGuard` (WhatsApp). Build `headers` from `req.headers`. For WhatsApp keep the GET verify handshake untouched. Each module `imports: [WebhooksModule, ...existing]`.
- [ ] **Step 4 — run** the 3 controller specs → PASS. **Run** `depcruise`. **Commit** `refactor(api): webhook controllers verify→persist→enqueue→ACK`.

---

## Phase G — Admin console (backend)

### Task 19: `AdminWebhooksService` + metrics service

**Files:** Create `admin/application/admin-webhooks.service.ts` + `.spec.ts`; `webhooks/application/webhook-metrics.service.ts` + `.spec.ts`.

**Interfaces — Produces:** `AdminWebhooksService.list(query)`, `.detail(id)`, `.retry(id, adminId, reason)`; `WebhookMetricsService.snapshot()`.

- [ ] **Step 1 — failing specs:**
  - `WebhookMetricsService.snapshot()` maps `countByStatus()` → `{ byStatus, depth: received+processing, failed, dead }`.
  - `AdminWebhooksService.retry`: loads the row; `resetToReceived(id)`; `dispatch.enqueue(id)`; `audit.record({ action:'admin_review', subject:'webhook:<id>', actorAdminId, details:{ reason, provider, providerEventId } })`; returns the refreshed detail. It moves NO money (§3.1). Retrying a non-existent id throws `NotFoundException`.
  - `list`/`detail` map records → contract shapes (ISO timestamps).
- [ ] **Step 2 — run** → FAIL. **Step 3 — implement** (inject `WEBHOOK_EVENT_REPOSITORY`, `WEBHOOK_DISPATCH`, `AuditService`). **Step 4 — run** → PASS. **Commit** `feat(api): AdminWebhooksService (list/detail/retry+audit) + WebhookMetricsService`.

### Task 20: `AdminWebhooksController` + DTOs + module wiring

**Files:** Create `admin/presentation/admin-webhooks.controller.ts` + `.spec.ts` + `dto/admin-webhooks.dto.ts`; modify `admin.module.ts`.

- [ ] **Step 1 — failing controller spec:** routes resolve to service; guards present (`AdminSessionGuard`, `PermissionGuard`; `AdminStepUpGuard` on retry); `@RequirePermission('api_route', 'GET /admin/webhooks', 'read')` etc.; retry passes `admin.adminId`.
- [ ] **Step 2 — run** → FAIL.
- [ ] **Step 3 — implement** (mirror `AdminComplianceController`): `@Controller('admin/webhooks')` `@UseGuards(AdminSessionGuard, PermissionGuard)`; `GET '' | 'metrics' | ':id'` (read) and `POST ':id/retry'` (`@HttpCode(200)`, `@UseGuards(AdminStepUpGuard)`, execute). Parse responses through the contract schemas. Register controller + `AdminWebhooksService` in `admin.module.ts`; `imports: [..., WebhooksModule]`.
- [ ] **Step 4 — run** spec + `depcruise` → PASS. **Commit** `feat(api): admin webhooks controller (permissioned + step-up retry)`.

### Task 21: Gate — full api suite + integration

- [ ] **Step 1 — run** `corepack pnpm@10.25.0 --filter @handshake-agent/api test` (unit) → all green.
- [ ] **Step 2 — run** `corepack pnpm@10.25.0 --filter @handshake-agent/api test:e2e` → green (fix any webhook e2e that asserted inline settlement — now assert 2xx + a persisted `WebhookEvent` row).
- [ ] **Step 3 — run** `corepack pnpm@10.25.0 --filter @handshake-agent/api typecheck && corepack pnpm@10.25.0 depcruise` → clean.
- [ ] **Step 4 — commit** any test fixups `test(api): update webhook e2e for persist-first flow`.

---

## Phase H — web-admin console

### Task 22: API clients + query hooks + nav/route-access

**Files:** Create `lib/api/webhooks.ts`; modify `lib/query/keys.ts` + `hooks.ts`, `components/admin/app-shell.tsx`, `lib/route-access.ts`.

- [ ] **Step 1 — clients** (`listWebhooks`, `getWebhookDetail`, `getWebhookMetrics`, `retryWebhook`) — GET/POST `/admin/webhooks*`, Zod-parse request + response (`WebhookListResponseSchema`, `WebhookDetailSchema`, `WebhookMetricsSchema`, `WebhookRetryRequestSchema`).
- [ ] **Step 2 — hooks**: `useWebhooks(query)` (staleTime 15s), `useWebhookDetail(id)` (enabled when id), `useWebhookMetrics()`, `useRetryWebhook()` (invalidates `["admin","webhooks"]`). Keys: `webhooks:(q)=>["admin","webhooks","list",q]`, `webhookDetail:(id)=>["admin","webhooks",id]`, `webhookMetrics:["admin","webhooks","metrics"]`.
- [ ] **Step 3 — nav**: add `{ href:"/webhooks", label:"Webhooks", icon: Webhook, menu:"menu.webhooks" }` to the Platform group in `app-shell.tsx`; add `"/webhooks": { menu: "menu.webhooks" }` to `route-access.ts`.
- [ ] **Step 4 — typecheck** web-admin. **Commit** `feat(web-admin): webhook api clients + hooks + nav entry`.

### Task 23: `WebhooksPage` (list + filters + detail drawer + retry) + test

**Files:** Create `app/webhooks/page.tsx`, `components/admin/webhooks-page.tsx`, `__tests__/webhooks-page.test.tsx`.

- [ ] **Step 1 — failing vitest** (mirror `sanctions-page.test.tsx`): mock `lib/api/webhooks` + `lib/api/admin` (getMe). Assert: loading→rows render (provider + status badge + attempts + receivedAt); empty state; error state + Retry; changing the status filter re-queries; opening a row shows payload/headers/attempts/error; clicking Retry calls `retryWebhook` and, on a `403 ADMIN_STEP_UP_REQUIRED`, opens `StepUpDialog` then replays via `useStepUpRetry`.
- [ ] **Step 2 — run** `corepack pnpm@10.25.0 --filter @handshake-agent/web-admin test -- webhooks-page` → FAIL.
- [ ] **Step 3 — implement** the page: header; filter bar (provider select, status select, from/to date, apply); four async branches (Skeleton / tokened error+Retry / empty / `Table`); status→Badge variant map (`received/processing`→info/warn, `succeeded`→success, `failed/dead`→danger); a right-side detail drawer with a JSON `<pre>` for payload+headers, an attempts/lastError block, and a Retry button wrapped in `useStepUpRetry` + `StepUpDialog`.
- [ ] **Step 4 — run** → PASS. **Commit** `feat(web-admin): webhooks console — list, filters, detail, audited retry`.

---

## Phase I — Verify + finish

### Task 24: Full gates + visual verification

- [ ] **Step 1 — run all gates** from root: `corepack pnpm@10.25.0 lint && corepack pnpm@10.25.0 typecheck && corepack pnpm@10.25.0 test && corepack pnpm@10.25.0 depcruise`. All green.
- [ ] **Step 2 — visual:** start web-admin via preview tools, seed a couple of `WebhookEvent` rows (script against the dev DB), load `/webhooks`, screenshot the list + detail drawer, exercise a filter. Capture proof.
- [ ] **Step 3 — PR:** push `feat/webhook-queue`; open PR titled **"feat(webhooks): durable queue + console replay"** with summary + test evidence (suite counts, screenshots).

---

## Self-Review (spec coverage)

- **Req 1 (verify→persist raw+headers+sig+provider+receivedAt→fast 2xx→async):** Tasks 1, 8, 18. ✔
- **Req 2 (real queue/worker, reuse infra; exp backoff + dead-letter; idempotent dedup on provider event id):** reuse BullMQ (Tasks 6, 11, 17); backoff in Task 6; dead-letter in Tasks 10–11 (`markDead`); dedup unique `(provider, providerEventId)` in Tasks 1, 5, 8. ✔
- **Req 3 (lifecycle: received→processing→succeeded/failed/dead + attempts + lastError + raw payload):** Tasks 1, 5, 10. ✔
- **Req 4 (admin Webhooks page: list+filters, detail payload/headers/attempts/error, permissioned+audited Retry that re-enqueues):** Tasks 2, 19, 20, 22, 23. ✔
- **Req 5 (queue-depth + failed-count reads for metrics):** `WebhookMetricsService` + `GET /admin/webhooks/metrics` (Tasks 19, 20) + `WebhookMetricsSchema` (Task 2). ✔
- **Strict TDD, Testcontainers persistence/dedup/retry/DLQ, web-admin vitest, all gates, visual verify:** Phases B–I. ✔
- **§3.1 preserved:** worker calls existing idempotent engine paths; admin retry only re-enqueues (Tasks 13–15, 19). ✔
