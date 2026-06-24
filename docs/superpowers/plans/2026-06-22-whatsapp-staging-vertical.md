# WhatsApp `crypto.buy` Staging Vertical — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the WhatsApp agent testable at a functional staging level by shipping one complete money-moving path — buy NGN→USDT — end to end: a real WhatsApp test number inbound → agent emits a validated intent → the deterministic engine proposes → itemized confirmation + PIN via an E2E-encrypted WhatsApp Flow → engine executes against live Blockradar + Flutterwave sandboxes → outbound reply.

**Architecture:** NestJS feature modules, layered inside (`presentation → application → domain`; `infrastructure` implements `application` ports). The model only _proposes_ (LangGraph agent emits a validated `Intent`); a separate deterministic engine _disposes_ (re-validates against the quote, runs the server-side KYC/velocity gate, verifies PIN + step-up, executes with an idempotency key, posts double-entry ledger). The agent core holds no Nest/Prisma imports. Mirror the existing `modules/quotes` vertical for layering, DI tokens (`Symbol`), and contracts usage.

**Tech Stack:** NestJS 11 (Express 5), Prisma 7 (`prisma-client` generator → `api/generated/prisma`, driver adapter `@prisma/adapter-pg`), `nestjs-zod` + `@handshake-agent/contracts` (Zod, pinned `^3.25.x`), LangGraph.js v1 (`@langchain/langgraph@1.4.4`, `@langchain/anthropic@1.5.0`, model `claude-opus-4-8`), Jest + `@nestjs/testing` + `@testcontainers/postgresql`, Node `crypto` for HMAC/AES-GCM/RSA-OAEP.

## Global Constraints (apply to every task)

- **§3.1 model-proposes / engine-disposes:** no LLM output moves money. The agent returns a validated `Intent`; only `modules/transactions` (the engine) constructs a `Transaction`. Even a faked LLM returns an intent, never an execution.
- **§3.2 agent has no DB:** `modules/agent/**` (the core) imports only `zod`, `@langchain/core` types, and the `LlmProvider` + `ToolGateway` ports — **no `@nestjs/*`, no `@prisma/client`, no `api/generated/prisma`, no concrete services.** `dependency-cruiser` must stay green.
- **§3.2 Prisma boundary:** only `infrastructure`-layer repositories import the generated client or inject `PrismaService`. `application`/`domain`/`presentation`/`agent` must not.
- **§3.3 server-side gate:** KYC status/tier, velocity, and limits are re-checked **in the engine at execute time**, never trusted from the Flow/frontend — even against a seeded test user.
- **§3.4 identity ≠ phone:** the WhatsApp `wa_id`/`from` is a routing key only (`ChannelIdentity`). Authorization is the bound device + KYC + PIN on the resolved `User`.
- **§3.5 WhatsApp surface:** official Cloud API + Flows only; no crypto Commerce/Catalog/Cart/Pay object; PIN/KYC secrets travel **only** through the Flow E2E channel, never plaintext chat; templates required outside the 24h window.
- **§3.6 no shortcuts:** no `pin === '0000'`, no stubbed signature checks, no placeholder settlement. `TODO(TICKET)` only with a reference.
- **§7 config:** secrets/infra → env (Zod-validated, fails boot); static defaults → JSON (`configuration.ts`); admin-tunable (spread/fees/limits/Flow-ids/templates) → `AppSetting` resolved on top. Nothing tunable hardcoded.
- **§8 contracts:** every FE⇄BE⇄agent shape is one Zod schema in `@handshake-agent/contracts`. Parse at every trust boundary.
- **§9 TDD:** red → green → refactor. ~100% coverage on domain + application + engine. Integration tests use real Postgres via Testcontainers, not mocks.
- **Money types:** fiat as `Decimal(38,2)`, crypto as `Decimal(38,18)` / byte-stable string snapshots; basis points as `Int`. Coerce strings→numbers once at the boundary (see `quotes.service.ts`).

## Definition of Done (staging acceptance)

A signed inbound WhatsApp text `"buy 5000 naira of usdt"` from the test number produces: a persisted `ConversationMessage` (deduped by `wamid`) → `MessageIntent(action=buy_crypto)` → a `Quote` + `Proposal(status=pending)` → an itemized confirmation Flow → on confirm+PIN (via the E2E Flow endpoint) a `Transaction(status=completed)` with balanced `LedgerEntry` rows, a Flutterwave virtual account collected against (sandbox) and a Blockradar child address credited (sandbox), and an outbound WhatsApp reply with the receipt. Every safety invariant above holds. CI is green: `pnpm --filter @handshake-agent/api lint typecheck test` and `pnpm depcruise`.

---

## File Structure (created/modified by this plan)

```
api/
├── .env                                   # MODIFIED — staging creds (gitignored, done)
├── .env.example                           # MODIFIED — new keys documented
├── src/
│   ├── main.ts                            # MODIFIED — rawBody:true for X-Hub-Signature
│   ├── app.module.ts                      # MODIFIED — register PrismaModule + feature modules
│   ├── core/
│   │   ├── config/env.schema.ts           # MODIFIED — WhatsApp/Blockradar/Flutterwave/secret vars
│   │   ├── config/configuration.ts        # MODIFIED — buy limits, drift bps, flow ids defaults
│   │   ├── prisma/prisma.service.ts       # NEW — driver-adapter client, $connect/$disconnect
│   │   ├── prisma/prisma.module.ts        # NEW — global, exports PrismaService
│   │   ├── crypto/hmac.ts                 # NEW — constant-time HMAC helpers (sha256/sha512)
│   │   └── auth/pin.service.ts            # NEW — scrypt PIN hash/verify + lockout
│   └── modules/
│       ├── whatsapp/                       # Phase 1 + 6
│       │   ├── presentation/whatsapp-webhook.controller.ts
│       │   ├── presentation/whatsapp-flow.controller.ts
│       │   ├── presentation/guards/whatsapp-signature.guard.ts
│       │   ├── application/whatsapp-inbound.mapper.ts
│       │   ├── application/ports/whatsapp-sender.port.ts
│       │   ├── application/ports/flow-crypto.port.ts
│       │   ├── infrastructure/cloud-api.sender.ts
│       │   ├── infrastructure/flow-crypto.service.ts
│       │   └── whatsapp.module.ts
│       ├── conversations/                  # Phase 2
│       │   ├── application/conversation.service.ts
│       │   ├── application/ports/*.repository.port.ts
│       │   ├── infrastructure/*.prisma.repository.ts
│       │   └── conversations.module.ts
│       ├── identity/                       # Phase 2
│       │   ├── application/identity.service.ts        # resolve channel→contact/user
│       │   ├── application/kyc-gate.service.ts        # §3.3 server-side gate
│       │   ├── application/ports/*.repository.port.ts
│       │   ├── infrastructure/*.prisma.repository.ts
│       │   └── identity.module.ts
│       ├── agent/                          # Phase 3 (framework-agnostic core + Nest adapter)
│       │   ├── core/agent.graph.ts                    # LangGraph; zero Nest/Prisma
│       │   ├── core/ports/llm-provider.port.ts
│       │   ├── core/ports/tool-gateway.port.ts
│       │   ├── infrastructure/anthropic-llm.provider.ts
│       │   ├── infrastructure/inprocess-tool-gateway.ts
│       │   └── agent.module.ts
│       ├── transactions/                   # Phase 4 (the engine)
│       │   ├── domain/ledger.ts                       # double-entry posting (pure)
│       │   ├── domain/buy-validation.ts               # drift/limit checks (pure)
│       │   ├── application/proposal.service.ts
│       │   ├── application/execution.service.ts
│       │   ├── application/directive.service.ts       # signed DirectiveGrant (HMAC)
│       │   ├── application/ports/*.port.ts
│       │   ├── infrastructure/*.prisma.repository.ts
│       │   └── transactions.module.ts
│       ├── wallets/                        # Phase 5 (Blockradar)
│       │   ├── application/ports/wallet-provider.port.ts
│       │   ├── infrastructure/blockradar.provider.ts
│       │   └── wallets.module.ts
│       └── treasury/                       # Phase 5 (Flutterwave)
│           ├── application/ports/payment-provider.port.ts
│           ├── infrastructure/flutterwave.provider.ts
│           └── treasury.module.ts
├── test/
│   ├── helpers/pg-testcontainer.ts        # NEW — shared Testcontainers Postgres
│   ├── helpers/seed.ts                     # NEW — seed Tier-1 user + device + PIN + wallet
│   └── buy-vertical.e2e-spec.ts            # NEW — Phase 7 acceptance (faked LLM)
└── scripts/
    ├── send-test-message.ts               # NEW — manual outbound smoke test
    └── simulate-inbound.http              # NEW — signed webhook curl for local drive

packages/contracts/src/
├── intents/buy-crypto.intent.ts           # exists (BuyCryptoIntent)
├── tools/quote-buy.tool.ts                # exists
├── tools/execute-buy.tool.ts              # NEW — engine proposal/confirm I/O
├── dto/buy-order.dto.ts                   # exists
├── whatsapp/flow-payload.ts               # NEW — Flow request/response + confirm/PIN screens
└── directives/ui-directive.ts             # NEW — UiDirective + confirmation/PIN directive schemas
```

---

# PHASE 0 — Foundations

_Outcome: app boots, env is fully validated, Prisma connects to a migrated DB. Independently testable._

### Task 0.1: Extend the env schema for staging secrets

**Files:**

- Modify: `api/src/core/config/env.schema.ts`
- Test: `api/src/core/config/env.schema.spec.ts` (exists — extend)

**Interfaces:**

- Produces: `envSchema`, `Env`, `validateEnv(raw)` (unchanged signatures; widened shape).

- [ ] **Step 1 — Write failing tests.** Add cases to `env.schema.spec.ts`: (a) a fully-populated valid env parses and exposes `WHATSAPP_PHONE_NUMBER_ID`, `BLOCKRADAR_BASE_URL`, `FLUTTERWAVE_SECRET_KEY`; (b) secret-but-optional vars (`WHATSAPP_APP_SECRET`, `DIRECTIVE_SIGNING_KEY`) are allowed empty/absent in `development`; (c) `WHATSAPP_GRAPH_VERSION` defaults to `v25.0`; (d) a bad `BLOCKRADAR_BASE_URL` (`"not-a-url"`) throws.
- [ ] **Step 2 — Run, expect fail.** `pnpm --filter @handshake-agent/api test -- env.schema` → FAIL.
- [ ] **Step 3 — Implement.** Extend `envSchema` (keep existing keys):

```ts
// append inside z.object({ ... })
  // WhatsApp
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_WABA_ID: z.string().optional().default(''),
  WHATSAPP_GRAPH_VERSION: z.string().min(1).default('v25.0'),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().optional().default(''),       // you add; HMAC for X-Hub-Signature
  WHATSAPP_VERIFY_TOKEN: z.string().optional().default(''),     // you add; GET handshake
  WHATSAPP_FLOW_PRIVATE_KEY: z.string().optional().default(''), // PEM; Flows phase
  WHATSAPP_TEST_RECIPIENT: z.string().optional().default(''),
  WHATSAPP_APP_ID: z.string().optional().default(''),
  // Blockradar (USDT-on-TRON). Auth is x-api-key; key is wallet-scoped.
  BLOCKRADAR_API_KEY: z.string().min(1),
  BLOCKRADAR_BASE_URL: z.string().url().default('https://api.blockradar.co/v1'),
  BLOCKRADAR_MASTER_WALLET_ID: z.string().min(1),
  BLOCKRADAR_WEBHOOK_SECRET: z.string().optional().default(''), // NOTE: BR signs deposit webhooks with the API key (HMAC-SHA512), not a separate secret.
  // Flutterwave (NGN collection)
  FLUTTERWAVE_SECRET_KEY: z.string().min(1),
  FLUTTERWAVE_BASE_URL: z.string().url().default('https://api.flutterwave.com/v3'),
  FLUTTERWAVE_WEBHOOK_SECRET: z.string().optional().default(''), // dashboard "secret hash"; verif-hash equality (v3)
  // Engine
  DIRECTIVE_SIGNING_KEY: z.string().optional().default(''),     // HMAC for DirectiveGrant; required before engine execute
```

In `test`/`development` these `.min(1)` vars must be present in `.env` (they are). For CI unit tests, provide them via the Jest setup or rely on `safeParse` only being invoked at boot — unit specs call `validateEnv` with explicit fixtures, so no global env needed.

- [ ] **Step 4 — Run, expect pass.** `pnpm --filter @handshake-agent/api test -- env.schema` → PASS.
- [ ] **Step 5 — Sync `.env.example`** with the same keys/comments (already structured; confirm parity).
- [ ] **Step 6 — Commit:** `feat(api): extend env schema with WhatsApp/Blockradar/Flutterwave staging vars`

### Task 0.2: PrismaService + global PrismaModule (driver adapter)

**Files:**

- Create: `api/src/core/prisma/prisma.service.ts`, `api/src/core/prisma/prisma.module.ts`
- Test: `api/src/core/prisma/prisma.service.spec.ts`
- Modify: `api/src/app.module.ts` (import `PrismaModule`)

**Interfaces:**

- Produces: `PrismaService extends PrismaClient` with `onModuleInit`/`onModuleDestroy`; `PrismaModule` (global, exports `PrismaService`). Repositories inject `PrismaService`.

- [ ] **Step 1 — Write failing test.** `prisma.service.spec.ts`: instantiate `PrismaService` and assert it is a `PrismaClient` instance and exposes `$connect`/`$disconnect` (unit-level; no live DB). Use the generated client type from `../../../generated/prisma`.
- [ ] **Step 2 — Run, expect fail** (file missing).
- [ ] **Step 3 — Implement.** Prisma 7 uses the driver adapter (`@prisma/adapter-pg` + `pg`, both installed). The generated client lives at `api/generated/prisma`.

```ts
// prisma.service.ts
import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma"; // ONLY infra/core may import this

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

```ts
// prisma.module.ts
import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

Add `PrismaModule` to `app.module.ts` imports. `main.ts` already calls `enableShutdownHooks()`.

- [ ] **Step 4 — Run, expect pass;** then `pnpm --filter @handshake-agent/api typecheck`.
- [ ] **Step 5 — depcruise:** `pnpm depcruise` stays green (PrismaService is in `core`, allowed).
- [ ] **Step 6 — Commit:** `feat(api): add PrismaService + global PrismaModule (pg driver adapter)`

### Task 0.3: Apply migration + boot verification

**Files:** none (operational) — uses the committed migration `20260622142238_init_full_schema`.

- [ ] **Step 1** — Ensure dev Postgres is up (docker `handshake-agent-pg` on `:5544`; `DATABASE_URL` in `.env` points to it).
- [ ] **Step 2** — `pnpm --filter @handshake-agent/api exec prisma migrate deploy` → applies the init migration. Expected: "1 migration applied".
- [ ] **Step 3** — `pnpm --filter @handshake-agent/api exec prisma generate` (no-op if current).
- [ ] **Step 4** — Wiring smoke: `pnpm --filter @handshake-agent/api typecheck` + unit suite green confirms module wiring; full process boot (`node dist`) is covered by Task 0.4 (pre-existing runtime-resolution gap). In-process boot is exercised by the Phase 7 e2e (ts-jest resolves contracts via `moduleNameMapper`).
- [ ] **Step 5 — Commit:** none (no source change).

### Task 0.4: Make the compiled app boot as a process (runtime contracts resolution)

> **Why:** `@handshake-agent/contracts` is `"type":"module"` with `exports`→`./src/*.ts` (source-only). `nest build` (tsc) leaves the path-alias specifier unresolved in emitted JS, and tsc expands output to `dist/api/src/main.js` + `dist/packages/contracts/src/*.js`. So `node dist/main` fails twice over. Jest (`moduleNameMapper`) and in-process e2e are unaffected; this only blocks the live Meta tunnel walkthrough (Phases 1.6/7.2). **Discovered during 0.3 — pre-existing drift, not introduced here.**

**Files:** `api/package.json` (scripts + devDep `tsc-alias`), maybe `api/nest-cli.json`.

- [ ] **Step 1 — Add** `tsc-alias` devDep (`pnpm --filter @handshake-agent/api add -D tsc-alias`).
- [ ] **Step 2 — Build pipeline:** `build` → `nest build && tsc-alias -p tsconfig.json` so emitted alias imports are rewritten to relative paths pointing at the compiled `dist/packages/contracts/src` copy.
- [ ] **Step 3 — Start scripts:** `start:prod` → `node dist/api/src/main`; confirm `start`/`start:dev` resolve the nested entry (set `nest-cli.json` `entryFile`/`exec` or use `node --watch dist/api/src/main` after build).
- [ ] **Step 4 — Verify:** build, then `node dist/api/src/main` boots, logs routes, Prisma connects against the dev DB (`:5544`) with no `ERR_MODULE_NOT_FOUND`.
- [ ] **Step 5 — Commit:** `fix(api): resolve contracts path alias at runtime so the app boots (tsc-alias)`.

---

# PHASE 1 — WhatsApp surface (inbound + outbound)

_Outcome: a signed inbound webhook is received, verified, and acked; an outbound text/template can be sent to the test number. Independently testable (echo bot)._

> Verified specifics (cite in code comments):
>
> - **GET verify:** `hub.mode=subscribe`, compare `hub.verify_token` to `WHATSAPP_VERIFY_TOKEN`, echo `hub.challenge` as 200 text.
> - **POST signature:** `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 of the **raw body** keyed by `WHATSAPP_APP_SECRET`. Must use raw bytes → set `NestFactory.create(AppModule, { rawBody: true })` and read `req.rawBody`.
> - **Inbound text path:** `entry[0].changes[0].value.messages[0].text.body`; ids: `messages[0].id` (wamid), `from`, `timestamp` (string seconds); `metadata.phone_number_id`; `contacts[0].wa_id`.
> - **Outbound:** `POST {BASE}/{GRAPH_VERSION}/{PHONE_NUMBER_ID}/messages`, `Authorization: Bearer {ACCESS_TOKEN}`, text/template/flow bodies per the research.

### Task 1.1: Raw-body bootstrap

- [ ] Modify `main.ts`: `NestFactory.create(AppModule, { bufferLogs: true, rawBody: true })`. Test: an e2e that POSTs to a throwaway route and asserts `req.rawBody` is a Buffer. Commit `feat(api): enable rawBody for webhook signature verification`.

### Task 1.2: Signature verification guard

**Files:** `whatsapp/presentation/guards/whatsapp-signature.guard.ts`, `core/crypto/hmac.ts` (+ specs).

- [ ] **TDD:** unit-test `hmac.ts` `verifyHmacSha256Hex(rawBody, secret, headerValue)` with a known vector (compute `sha256=` expected, assert true; tamper → false; constant-time via `crypto.timingSafeEqual`). Then `WhatsAppSignatureGuard` reads `req.rawBody` + `x-hub-signature-256`, calls the helper with `WHATSAPP_APP_SECRET`, throws `UnauthorizedException` on mismatch. Skip-with-warning only when `WHATSAPP_APP_SECRET===''` **and** `NODE_ENV!=='production'\*\* (so you can drive locally before adding the secret) — log loudly. Commit.

### Task 1.3: Webhook controller (GET verify + POST receive)

**Files:** `whatsapp/presentation/whatsapp-webhook.controller.ts`, `whatsapp/application/whatsapp-inbound.mapper.ts` (+ specs).

- [ ] **TDD:** controller spec — GET with matching `hub.verify_token` returns the challenge (200); mismatch → 403. POST (guarded) parses the payload via `WhatsAppInboundMessage` (a contracts Zod schema, Task 1.4), maps to an `InboundMessage` app DTO `{ externalMessageId, fromAddress, phoneNumberId, waName, text, timestamp, channel:'whatsapp' }`, hands it to `ConversationService.handleInbound` (Phase 2 — inject the port; for Phase 1 a stub that returns 200), and **always responds 200 fast** (ack-then-process; Meta retries non-2xx). Commit.

### Task 1.4: Inbound payload contract

**Files:** `packages/contracts/src/whatsapp/inbound.ts` (+ test).

- [ ] **TDD:** `WhatsAppInboundSchema` parses the verified payload shape; a fixture (real shape from research) parses; a non-text message type is tolerated (ignored, not thrown). Export from contracts barrel. Commit.

### Task 1.5: Outbound sender (Cloud API client)

**Files:** `whatsapp/application/ports/whatsapp-sender.port.ts`, `whatsapp/infrastructure/cloud-api.sender.ts` (+ spec), `scripts/send-test-message.ts`.

**Interfaces:**

- Produces: `WHATSAPP_SENDER` token; `IWhatsAppSender { sendText(to, body): Promise<{ externalMessageId }>; sendTemplate(to, name, lang, components?): Promise<...>; sendFlow(to, params): Promise<...> }`.

- [ ] **TDD:** spec the sender against a mocked `HttpService`/`axios` (assert URL `{BASE}/{VER}/{PHONE_NUMBER_ID}/messages`, bearer header, body shape for text + template). Implement with `@nestjs/axios`. `sendFlow` added in Phase 6.
- [ ] **Manual smoke (staging):** `scripts/send-test-message.ts` sends the `hello_world` template to `WHATSAPP_TEST_RECIPIENT` (the curl the user provided). Run once, confirm delivery. Commit `feat(api): WhatsApp Cloud API outbound sender`.

### Task 1.6: whatsapp.module wiring — echo bot checkpoint

- [ ] Wire `WhatsAppModule` (controller, guard, sender, mapper). Temporary: `ConversationService` stub echoes inbound text back via the sender. **Checkpoint:** with a public tunnel (see Risks) + webhook subscribed, sending a WhatsApp message to the test number echoes back. Commit, then remove the echo stub when Phase 2 lands.

---

# PHASE 2 — Conversations + identity

_Outcome: inbound message is deduped, persisted, resolved to a Contact/User, and routed; replies persisted + dispatched. Identity ≠ phone enforced._

### Task 2.1: Identity resolution

**Files:** `identity/application/identity.service.ts` + repository ports + `*.prisma.repository.ts` + specs.

**Interfaces:**

- Produces: `IdentityService.resolveByChannel({ channel, channelAddress, normalizedPhone }): Promise<ResolvedIdentity>` where `ResolvedIdentity = { kind:'user', user } | { kind:'contact', contact }`. Looks up `ChannelIdentity` (active, `deletedAt null`); if linked → `User`; else find/create `Contact` + `ChannelIdentity`. Detects SIM-swap (`simSwapDetectedAt`) and surfaces a gate flag. **Never** treats the phone as authorization (§3.4).

- [ ] **TDD (integration, Testcontainers):** seeded linked `ChannelIdentity` → returns the `User`; unknown number → creates `Contact` + `ChannelIdentity` (status pending), returns contact; a number with `simSwapDetectedAt` set → `ResolvedIdentity` carries `requiresReverification:true`. Commit.

### Task 2.2: KYC / velocity gate (server-side)

**Files:** `identity/application/kyc-gate.service.ts` + velocity repo + specs.

**Interfaces:**

- Produces: `KycGateService.assertCanTransact({ userId, fiatAmount, asset }): Promise<void>` — throws typed domain errors (`KycInsufficientError`, `VelocityExceededError`, `SimSwapError`). Reads tier limits + velocity caps from `AppSetting` (scope `tier`) layered over `configuration.ts` defaults. This is the §3.3 gate; the engine calls it again at execute time.

- [ ] **TDD:** Tier-1 user under daily cap passes; over per-tx limit throws `KycInsufficientError`; exceeding velocity (seed `VelocityCounter`) throws `VelocityExceededError`. Limits come from config, not literals. Commit.

### Task 2.3: Conversation orchestration

**Files:** `conversations/application/conversation.service.ts` + repos (`ConversationRepository`, `MessageRepository`, `IntentRepository`, `ReplyRepository`) + specs.

**Interfaces:**

- Consumes: `IdentityService`, `AgentPort` (Phase 3), `ProposalService` (Phase 4), `IWhatsAppSender`.
- Produces: `ConversationService.handleInbound(InboundMessage): Promise<void>` — (1) **dedup** by `externalMessageId` (wamid) `@unique` → if seen, no-op (NFR-7); (2) resolve identity; (3) upsert `Conversation` (Contact XOR User); (4) persist `ConversationMessage(processingStatus=received)`; (5) call agent → `Intent`; (6) persist `MessageIntent`; (7) route by `action`: `buy_crypto` → `ProposalService.createBuyProposal` → reply with confirmation Flow directive; `none` → reply clarification; `check_balance` → read-only; (8) persist `ConversationReply` + dispatch via sender; (9) mark message `processed`.

- [ ] **TDD (integration):** duplicate wamid → second call is a no-op (one message row). A `buy_crypto` intent (faked agent) → creates proposal + reply. A `none` intent → clarification reply, no proposal. Errors mark message `failed` + send a safe fallback reply (four-branch). Commit. Replace the Phase 1 echo stub binding with the real service.

---

# PHASE 3 — Agent (the "proposes" half)

_Outcome: free text → validated `Intent` via LangGraph, behind ports, with a fake LLM for tests. Zero DB/Nest in the core._

### Task 3.1: LLM + ToolGateway ports (core)

**Files:** `agent/core/ports/llm-provider.port.ts`, `agent/core/ports/tool-gateway.port.ts`.

**Interfaces (pure TS, no Nest):**

- `LlmProvider { extractIntent(messages: AgentMessage[], opts): Promise<Intent> }` — wraps `model.withStructuredOutput(IntentSchema)`.
- `ToolGateway { call<TName>(name, input): Promise<unknown> }` — read-only tools only (e.g. `quote_buy`); side-effecting tools build proposals, never execute.
- [ ] **TDD:** type-only + a fake `LlmProvider` returning a canned `BuyCryptoIntent`. Commit.

### Task 3.2: Agent graph (core)

**Files:** `agent/core/agent.graph.ts` (+ spec).

- [ ] **TDD:** `runAgent({ text, llm, tools }): Promise<Intent>` — minimal LangGraph (or a single structured-output call wrapped graph-ready) parsed through `IntentSchema`. Test with the fake LLM: `"buy 5000 naira of usdt"` → `{action:'buy_crypto', asset:'USDT', fiatAmount:'5000', fiatCurrency:'NGN'}`; gibberish → `{action:'none', clarification:...}`. **depcruise:** assert no `@nestjs/*`/`@prisma/*` import reaches `agent/core/**`. Commit.

### Task 3.3: Anthropic adapter + Nest wiring

**Files:** `agent/infrastructure/anthropic-llm.provider.ts`, `agent/infrastructure/inprocess-tool-gateway.ts`, `agent/agent.module.ts`, `agent/application/agent.port.ts` (the Nest-facing `AgentPort` token).

- [ ] **TDD:** `AnthropicLlmProvider` uses `ChatAnthropic` (model `AGENT_MODEL`, `ANTHROPIC_API_KEY`) — only here. In-process `ToolGateway` calls `QuotesService`. `AgentModule` provides `AGENT_PORT` → an adapter that runs the graph; in `test`, bind a fake provider via a Nest test override. Commit.

---

# PHASE 4 — Engine (the "disposes" half) — the heart

_Outcome: proposal → re-validate → confirm → PIN → execute → idempotent settlement + double-entry ledger. ~100% coverage._

### Task 4.1: Pricing/quote persistence + proposal creation

**Files:** `transactions/application/proposal.service.ts`, `transactions/domain/buy-validation.ts`, repos + specs; `packages/contracts/src/tools/execute-buy.tool.ts`.

**Interfaces:**

- `ProposalService.createBuyProposal({ userId, conversationId, intent }): Promise<{ proposal, quote, confirmation }>` — calls `QuotesService.quoteBuy`, persists a `Quote`, runs `KycGateService.assertCanTransact`, persists a `Proposal(type=buy, status=pending, quoteId, parameters, parametersChecksum=sha256, expiresAt)`, returns the itemized `confirmation` (asset, fiatAmount, cryptoAmount, fxRate, spreadBps, processingFeeBps, fee, total) for the Flow.
- [ ] **TDD:** valid intent → pending proposal + valid quote + checksum; gate failure → no proposal, typed error; amounts match the quote exactly. Commit.

### Task 4.2: Signed directive (DirectiveGrant) for confirm/PIN

**Files:** `transactions/application/directive.service.ts` (+ spec).

- [ ] **TDD:** `DirectiveService.issue({ proposalId, userId, ref })` mints a `DirectiveGrant` — CSPRNG nonce (store hash only), HMAC-SHA256 over `(directiveId, ref, proposalId, nonce, expiresAt, userId, origin)` keyed by `DIRECTIVE_SIGNING_KEY`, `origin=engine`. `consume({ directiveId, nonce, proposalId })` is atomic (consume-on-redeem), rejects replay/expired/mismatched proposal. High-trust refs (`show_confirmation`,`request_pin`) require `origin∈{engine,core}` + valid signature. Commit. (Generate `DIRECTIVE_SIGNING_KEY` now: `openssl rand -hex 32` → `.env`.)

### Task 4.3: PIN service

**Files:** `core/auth/pin.service.ts` (+ spec).

- [ ] **TDD:** `setPin`/`verifyPin` using Node `crypto.scrypt` (salted; `pinHash` stores `salt:hash`). Lockout: increment `pinFailureCount`, set `pinLockedUntil` after N (config) failures; locked → `PinLockedError`; success resets the counter. **No `0000` shortcut.** `TODO(SEC-XX): migrate to argon2id for production` (schema notes argon2id; scrypt is a valid interim KDF). Commit.

### Task 4.4: Ledger domain (double-entry)

**Files:** `transactions/domain/ledger.ts` (+ spec).

- [ ] **TDD:** `buildBuyLedgerEntries({ userId, walletId, fiatAmount, cryptoAmount, fees })` returns ≥2 balanced entries (sum to zero per currency), correct `direction`/`accountType` (`user_wallet` credit USDT, `platform_float`/`processor_settlement` for NGN), monotonic `sequence`, `balanceAfter`. Pure function; property test that debits+credits net zero. Commit.

### Task 4.5: Execution service (idempotent)

**Files:** `transactions/application/execution.service.ts` (+ integration spec).

**Interfaces:**

- `ExecutionService.executeBuy({ proposalId, directiveId, nonce, pin, deviceId, idempotencyKey }): Promise<Transaction>`:
  1. load proposal (must be `pending`/`confirmed`, not expired);
  2. **re-validate** quote (drift ≤ `buy.maxDriftBps` from config) — re-quote, reject on drift;
  3. **re-run** `KycGateService.assertCanTransact` (§3.3);
  4. consume the `DirectiveGrant` (Task 4.2);
  5. `PinService.verifyPin` + step-up check (Session.stepUpCompletedAt);
  6. **idempotency:** `Transaction.idempotencyKey @unique` — if exists, return the existing txn (NFR-7);
  7. in one DB transaction: create `Transaction(status=validating→settling)`, write `LedgerEntry` rows, enqueue `SettlementOutbox` rows (`processor_collection` for Flutterwave, on-chain credit for Blockradar);
  8. drive settlement via provider ports (Phase 5); on success `status=completed`, mint `Receipt`; on failure `status=failed` + `CompensationRecord`.
- [ ] **TDD (integration, Testcontainers):** happy path → `completed` txn + balanced ledger + receipt; replay same `idempotencyKey` → same txn, no double-post; drifted quote → rejected, no txn; bad PIN → `failed`/no settlement; gate failure at execute → rejected even if proposal passed earlier. Commit.

---

# PHASE 5 — Live sandbox providers (behind ports)

_Outcome: real Blockradar + Flutterwave sandbox calls behind swappable ports._

### Task 5.1: Wallet provider (Blockradar)

**Files:** `wallets/application/ports/wallet-provider.port.ts`, `wallets/infrastructure/blockradar.provider.ts` (+ spec), `wallets.module.ts`.

> Verified: base `https://api.blockradar.co/v1`; auth `x-api-key: <BLOCKRADAR_API_KEY>` (wallet-scoped); create child address `POST /wallets/{BLOCKRADAR_MASTER_WALLET_ID}/addresses` (optional `name`,`metadata`) → `data.id`,`data.address`; balance `GET /wallets/{walletId}/addresses/{addressId}/balance?assetId=f56d297c-a3db-4cda-95bd-180b54679070` → `data.balance` (decimal string, USDT decimals=6); deposit webhook header `x-blockradar-signature` = HMAC-SHA512 over body keyed by the API key, txHash field is `hash`. Asset/blockchain ids belong in config (`AppSetting` `provider:blockradar`), not literals.

**Interfaces:** `IWalletProvider { provisionAddress(userRef): Promise<{ providerReference, address, network }>; getBalance(addressId): Promise<{ amount, decimals }> }`.

- [ ] **TDD:** unit-test against mocked HTTP (assert `x-api-key`, path, body, response mapping). Then a **sandbox integration** test (gated by env presence) that provisions a TRON child address against the real test wallet and reads its balance. Persist `Wallet` + `WalletBalance`. Commit.

### Task 5.2: Payment provider (Flutterwave)

**Files:** `treasury/application/ports/payment-provider.port.ts`, `treasury/infrastructure/flutterwave.provider.ts` (+ spec), `treasury.module.ts`.

> Verified: base `https://api.flutterwave.com/v3`, `Authorization: Bearer FLUTTERWAVE_SECRET_KEY`; collect via `POST /virtual-account-numbers` (dynamic: `email, amount, tx_ref(unique), firstname, lastname, narration`) → `account_number, bank_name, flw_ref, expiry_date`; verify via `GET /transactions/verify_by_reference?tx_ref=` → `data.status==='successful'`, check amount/currency/tx_ref; webhook header `verif-hash` **equality** to `FLUTTERWAVE_WEBHOOK_SECRET` (v3). **Always re-verify server-side.** Dedup on `tx_ref`. ⚠️ Simulating an inbound NGN transfer to a VA in test mode is not clearly documented — see Risks.

**Interfaces:** `IPaymentProvider { createCollection({ amount, currency, reference, customer }): Promise<{ accountNumber, bankName, providerRef, expiresAt }>; verify(reference): Promise<{ status, amount, currency }> }`.

- [ ] **TDD:** unit-test against mocked HTTP (assert bearer, path, body, mapping, `verif-hash` equality + constant-time). Sandbox integration (gated) that creates a VA. Commit.

### Task 5.3: Wire providers into the engine

- [ ] Bind `IWalletProvider`/`IPaymentProvider` into `ExecutionService` settlement. Integration test the buy with sandbox providers (collection created + address credited path). Commit.

---

# PHASE 6 — WhatsApp Flows E2E (confirm + PIN)

_Outcome: itemized confirmation + PIN collected via an E2E-encrypted Flow; secrets never in plaintext chat._

### Task 6.1: Flow crypto service

**Files:** `whatsapp/infrastructure/flow-crypto.service.ts`, `whatsapp/application/ports/flow-crypto.port.ts` (+ spec).

> Verified crypto (Meta reference): request `{ encrypted_flow_data, encrypted_aes_key, initial_vector }` (base64). Decrypt: RSA unwrap AES key with `privateDecrypt({ key, padding: RSA_PKCS1_OAEP_PADDING, oaepHash:'sha256' })`; AES key 16 bytes; `encrypted_flow_data` = ciphertext + last-16-byte GCM tag; `createDecipheriv('aes-128-gcm', key, iv)`, `setAuthTag(tag)`. Respond: same key, **IV bit-flipped (~each byte)**, `aes-128-gcm`, output `cipher.update + final + getAuthTag()` base64 as the **raw 200 body**. Decrypt failure → HTTP **421**. `ping` → `{ data: { status: 'active' } }`.

- [ ] **TDD:** generate a 2048-bit RSA keypair in the test; encrypt a sample request the way Meta would; assert `decrypt` round-trips and `encryptResponse` produces a body that decrypts back with the flipped IV. Tampered tag → throws (→421). Use `WHATSAPP_FLOW_PRIVATE_KEY` (PEM). Commit.
- [ ] **Setup step:** `openssl genrsa 2048` → private key to `.env` (`WHATSAPP_FLOW_PRIVATE_KEY`, escaped newlines); upload the public key to Meta; create the confirmation+PIN Flow and put its `flow_id` in `AppSetting`.

### Task 6.2: Flow endpoint controller

**Files:** `whatsapp/presentation/whatsapp-flow.controller.ts` (+ spec); `packages/contracts/src/whatsapp/flow-payload.ts`.

- [ ] **TDD:** POST decrypts via the crypto service; routes by `action`: `ping`→active; `INIT`→return the confirmation screen data (from the proposal bound to `flow_token`); `data_exchange` on the PIN screen → call `ExecutionService.executeBuy` with the decrypted PIN + the directive nonce; return a success/next screen. Errors → encrypted error screen (never leak). `flow_token` binds to the `Proposal`/`DirectiveGrant`. **PIN exists only inside the decrypted payload** (§3.5). Commit.

### Task 6.3: Send-flow + confirmation directive

- [ ] Implement `IWhatsAppSender.sendFlow` (interactive `type:flow`, `flow_message_version:'3'`, `flow_token`, `flow_id`, `flow_cta:'Confirm'`, `flow_action:'navigate'`, `flow_action_payload.screen + data`). `ConversationService` sends it for a `buy_crypto` proposal. Add `UiDirective`/confirmation/PIN schemas to contracts. Commit.

---

# PHASE 7 — Acceptance (CI e2e + staging walkthrough)

### Task 7.1: CI e2e (deterministic)

**Files:** `test/buy-vertical.e2e-spec.ts`, `test/helpers/pg-testcontainer.ts`, `test/helpers/seed.ts`.

- [ ] **TDD:** boot `AppModule` against Testcontainers Postgres with a **faked `LlmProvider`** (override) and provider ports pointed at sandbox or fakes. Seed a Tier-1 user (device bound, PIN set, wallet provisioned). POST a **signed** inbound `"buy 5000 naira of usdt"` → assert: one `ConversationMessage`, a `MessageIntent(buy_crypto)`, a `Proposal(pending)`, a confirmation reply. Simulate the Flow `data_exchange` with the correct PIN+nonce → assert `Transaction(completed)`, balanced ledger, receipt, outbound reply. Replay the webhook → no duplicate. Commit.

### Task 7.2: Staging walkthrough (manual, documented)

- [ ] With the public tunnel + webhook subscribed + Flow published: from the real test number send the buy message; complete the confirmation+PIN Flow; observe the sandbox collection + address credit + receipt reply. Document the runbook in `docs/runbooks/whatsapp-buy-staging.md`. (Manual; not CI.)

---

## Risks / decisions to confirm during execution

1. **Public HTTPS for webhook + Flow endpoint.** Meta must reach both. Use a tunnel (cloudflared/ngrok) or a deployed staging host; configure the callback URL + `WHATSAPP_VERIFY_TOKEN` and upload the Flow public key. Gates Phases 1.6, 6, 7.2 (not their CI tests).
2. **Meta temp token (~24h).** `WHATSAPP_ACCESS_TOKEN` expires; sends will 401. Swap for a System User long-lived token before sustained staging.
3. **App Secret + Verify Token.** You're adding these to `.env`; signature verification (Task 1.2) and GET handshake (1.3) need them. Until then the guard runs in skip-with-warning (dev only).
4. **Flutterwave VA inbound simulation.** Triggering a `charge.completed` for a virtual account in test mode isn't clearly documented — may need dashboard simulate/retry tooling or support. If blocked, the CI e2e uses a faked `IPaymentProvider.verify`; the live VA-credit step stays a documented manual check.
5. **Flutterwave webhook shape drift (v3 vs v4).** v3 = `event`/`status:"successful"`/`verif-hash` equality; newer = `type`/`status:"succeeded"`/`flutterwave-signature` HMAC. Confirm which the account emits; branch the handler.
6. **Blockradar webhook secret.** Deposit webhooks are HMAC-SHA512 keyed by the **API key** (no separate secret). `BLOCKRADAR_WEBHOOK_SECRET` is unused unless the dashboard offers one.
7. **PIN KDF.** Using `scrypt` now; schema notes argon2id for production (`TODO(SEC)`).

## Self-review notes

- Spec coverage: every P0/P1 feature from the prioritized roadmap maps to a task (Prisma→0.2; webhook+signature+idempotency→1.2/1.3/2.3; env→0.1; conversation/identity→2.x; agent→3.x; engine spine→4.x; KYC gate→2.2+4.5; PIN+step-up→4.3+4.5; execute-buy contracts→4.1; providers→5.x; Flows E2E→6.x; e2e→7.1).
- Type consistency: `IWhatsAppSender`, `IWalletProvider`, `IPaymentProvider`, `LlmProvider`, `ToolGateway`, `ResolvedIdentity`, `executeBuy(...)` names are used consistently across the tasks that consume them.
- Placeholder scan: integration tasks cite verified endpoints; the only deferred-detail items are the documented Risks (external, not code placeholders).

```

```
