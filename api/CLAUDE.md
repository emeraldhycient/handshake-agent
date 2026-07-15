# api — CLAUDE.md

NestJS 11 backend: the system of record, the deterministic execution engine, the typed tool layer, and the embedded LangGraph agent. Read the root [`CLAUDE.md`](../CLAUDE.md) first — its invariants (§3) and clean-architecture rules (§4) are binding here. This file adds backend specifics.

## Architecture — feature modules, layered inside

```
src/
├── main.ts                 # bootstrap (API process): helmet, pino logger, global ZodValidationPipe, shutdown hooks
├── app.module.ts           # composition root: ConfigModule (global), feature modules, APP_PIPE
├── worker.ts               # bootstrap (WORKER process): NestFactory.createApplicationContext, no HTTP
├── worker.module.ts        # AppModule + the BullMQ @Processor classes
├── cli/                    # one-off operational commands (e.g. backfill-wallet-networks)
├── core/                   # cross-cutting
│   ├── config/             # layered config: configuration.ts (code defaults) + zod-validated env → typed ConfigService; EffectiveConfigService (DB-admin overlay)
│   ├── logging/            # nestjs-pino
│   ├── prisma/             # PrismaService ($connect onModuleInit, enableShutdownHooks)
│   ├── auth/               # PIN, step-up, device binding, sessions
│   ├── audit/              # immutable admin/audit log writer
│   ├── catalog/            # AssetRegistry — assets/networks/fiats catalog + capability gating
│   ├── crypto/             # hashing/HMAC helpers (sha256Hex, directive/receipt signing)
│   ├── jobs/               # BullMQ queue registration (producer side)
│   └── common/             # filters, interceptors, guards (throttler), decorators
└── modules/<feature>/      # 19 feature modules — see root CLAUDE.md §4.1 for the list
    ├── domain/             # entities, value objects, enums, domain errors — PURE
    ├── application/        # use-case services + ports (interfaces) + app DTOs
    ├── infrastructure/     # Prisma repositories + external clients implementing ports
    └── presentation/       # controllers + request/response DTOs (nestjs-zod)
```

**Dependency rule (enforced by `dependency-cruiser`):** `presentation → application → domain`; `infrastructure` implements `application` ports. `application` must never import `infrastructure`, `@prisma/client`, the generated client, or `core/prisma`; `presentation` must never import `infrastructure`. `domain` imports nothing framework-specific.

**Two deployable processes.** The backend ships as the HTTP **API** (`main.ts`) and a **worker** (`worker.ts`) sharing one codebase, DB, and Redis. The worker boots `WorkerModule` (AppModule + the `@Processor` classes) via `createApplicationContext` — no HTTP server — and drains BullMQ: webhook processing, settlement-outbox dispatch, dead-letter, `@Cron` sweepers and reconciliation. The API process never opens BullMQ Worker connections (e2e suites stay clean without Redis); `REDIS_URL` must point at a real Redis in staging/prod. Run with `start:worker` (prod) / `start:worker:dev`. See [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) §2.1.

## Prisma — the only door to the database

This is **Prisma 7** (`@prisma/client` ^7). It uses the new `prisma-client` generator: the client is generated into `api/generated/prisma` (gitignored, regenerate with `prisma generate`), and config lives in `api/prisma.config.ts` (schema path, migrations path, `datasource.url` from `DATABASE_URL`). The schema is at `api/prisma/schema.prisma`.

- **Only `infrastructure`-layer repositories import the generated client** (from `api/generated/prisma`) or inject `PrismaService`. Controllers, application/domain services, DTOs, and the agent must not. `dependency-cruiser` forbids importing `api/generated/prisma`, `@prisma/client`, **and** `api/src/core/prisma` from `application`/`domain`/`agent` (the generated tree is kept visible as a rule target via `doNotFollow`, never `exclude`) — this realizes root-`CLAUDE.md` §3.2.
- Wrap the client in a `PrismaService` (`onModuleInit` → `$connect`; call `app.enableShutdownHooks()` in `main.ts`). Inject it only into repositories.
- pnpm 10 blocks Prisma's engine build script by default; the root `package.json` `pnpm.onlyBuiltDependencies` allowlist re-enables it. Run `prisma generate` before any code imports the client.

```bash
pnpm --filter @handshake-agent/api exec prisma migrate dev --name <name>   # dev: migrate + generate
pnpm --filter @handshake-agent/api exec prisma generate                    # regenerate client
pnpm --filter @handshake-agent/api exec prisma migrate deploy              # CI/prod: apply, no prompt
```

## Validation, config, logging

- **Validation:** `nestjs-zod`. Wrap shared schemas from `@handshake-agent/contracts` with `createZodDto`; register `ZodValidationPipe` globally via `APP_PIPE`. Do not redefine request shapes — import them. Server-side validation is security, not UX (root §3.3).
- **Config (layered DB › env › code defaults, root §7):** the defaults layer is `src/core/config/configuration.ts` (committed TypeScript — there is no `api/config/defaults/*.json`), loaded via `ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: (raw) => envSchema.parse(raw) })`. Invalid env fails boot. Read env via a typed `ConfigService<Env, true>`; admin-tunable values resolve through **`EffectiveConfigService`**, which overlays the DB `AppSetting` layer (hot-reloaded, cache-invalidated) on top of the defaults.
- **Logging:** `nestjs-pino`, set as the Nest logger (`app.useLogger(app.get(Logger))`, `bufferLogs: true`). `pino-pretty` in dev only; raw JSON in prod.

## The agent module (`modules/agent/`)

LangGraph.js **v1** (`@langchain/langgraph@1.4.4`, `@langchain/core@1.2.0`, `@langchain/anthropic@1.5.0`). See root [`CLAUDE.md`](../CLAUDE.md) §6.

- Agent **core** is framework-agnostic — imports only `zod`, `@langchain/core` types, and the `LlmProvider` + `ToolGateway` ports. **No Nest, no concrete services, no `@prisma/client`** (dependency-cruiser enforces this).
- `ChatAnthropic` appears **only** in the `LlmProvider` adapter. Default model id: `claude-opus-4-8`; `ANTHROPIC_API_KEY` from env.
- The graph **emits a validated intent** (`model.withStructuredOutput(IntentSchema)` from `@handshake-agent/contracts`); it executes nothing. Side-effecting tools build proposals for the deterministic engine.
- Do not instantiate a checkpointer here (would re-couple to the DB). Keep the `ToolGateway` binding swappable for later extraction to a standalone service.
- ESM-under-CJS: always `import` these packages (tsc downlevels); never hand-write `require()`.

## The media module (`modules/media/`)

Exposes `TRANSCRIPTION_PORT` (speech→text via OpenAI-compatible Whisper; mocked by default via `TRANSCRIPTION_MOCK_MODE=true`, real adapter on `false` with `TRANSCRIPTION_API_KEY`) and `DOCUMENT_EXTRACTION_PORT` (image/document→structured data via Claude vision; mocked by default via `MEDIA_EXTRACTION_MODE=true`, real adapter reuses `ANTHROPIC_API_KEY`). Integrated into the web `POST /chat/voice` endpoint (transcribe→WebChatService) and WhatsApp inbound multimedia handler (`WhatsAppInboundService.ingest`: audio→transcript→agent intent; image/document→extract→beneficiary save). Config keys (TRANSCRIPTION_MODEL, TRANSCRIPTION_BASE_URL, MEDIA_EXTRACTION_MODEL) live in `.env.example` and are validated at boot.

## The MCP module (`modules/mcp/`)

`POST /mcp` is a **stateless Streamable-HTTP** MCP endpoint for external AI clients (root `CLAUDE.md` §6 → "The MCP surface").

- **Auth is PAT-only** (`PatAuthGuard`, `Bearer hsk_pat_…`): session JWTs are rejected here, and PATs never work on the JWT surfaces. PATs are minted PIN-gated at `POST /profile/tokens` (`modules/auth`), stored as SHA-256 hashes, scoped `read` / `chat:propose` — **no execute scope exists**.
- **Stateless transport**: each request builds a fresh per-principal `Server` + `StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`, `enableJsonResponse: true`) — no session ids, no SSE stream (GET/DELETE return 405), no sticky routing needed. The app-wide throttler stays active (deliberately no `@SkipThrottle`).
- **Tools read and propose only** (§3.1): read tools return data; chat tools drive the same propose-only agent pipeline. Nothing under `modules/mcp` may execute, authorize, or accept a PIN.
- **SDK note**: this module uses the **low-level SDK `Server`** with `zod-to-json-schema` for tool input schemas — the high-level `McpServer` API hits TS2589 (excessively deep type instantiation) against our zod version. Keep new tools on the established pattern in `application/mcp-tool-dispatch.ts`.

## Commands

```bash
pnpm --filter @handshake-agent/api start:dev    # nest watch mode — restarts on change
pnpm --filter @handshake-agent/api dev          # ts-node, NO watch — see warning below
pnpm --filter @handshake-agent/api start:worker:dev  # worker process (ts-node)
pnpm --filter @handshake-agent/api build        # tsc build (nest build + tsc-alias)
pnpm --filter @handshake-agent/api lint         # flat-config ESLint (auto-fix)
pnpm --filter @handshake-agent/api typecheck    # tsc --noEmit
pnpm --filter @handshake-agent/api test         # jest unit (config inline in package.json)
pnpm --filter @handshake-agent/api test:e2e     # supertest e2e (test/jest-e2e.json) — also a gating CI job (worker-capped, run locally too)
pnpm --filter @handshake-agent/api test:cov     # coverage
```

> **`dev` vs `start:dev` — do not confuse them.** `dev` runs plain `ts-node` with **no file watching**: after any code change you must kill and restart it, or you will debug against stale code (this has repeatedly cost real debugging time). Use `start:dev` (nest `--watch`) when iterating; use `dev` when you need a single stable process (e.g. the visual-verify runbook's `PORT=3001 pnpm dev`).

## Testing (strict TDD, root §9)

Red → Green → Refactor. ~100% coverage on `domain` + `application` + the execution engine. Unit test config is the inline `jest` block in `package.json` (`*.spec.ts`, `rootDir: src`); e2e is `test/jest-e2e.json` (`*.e2e-spec.ts`). Integration/e2e tests use `@testcontainers/postgresql` against real Postgres — not mocks. **This lane runs BOTH locally (`test:e2e`) and as a gating CI `e2e` job** (worker-capped `--maxWorkers=2 --workerIdleMemoryLimit=1500M` + raised Node heap to avoid OOM); CI also runs the unit suites with coverage thresholds (`test:cov`). Run the e2e suites yourself for anything on the money path. The contracts `moduleNameMapper` is already wired into the Jest config so shared schemas resolve.

## Stack gotchas (verified)

- NestJS `11.1.27`, **Express 5** underneath: wildcard routes use `/*splat` syntax; query parsing differs from Express 4. `ThrottlerModule` is v6-style (named throttlers array, ttl in **ms**).
- `reflect-metadata` and `rxjs` are already installed — do not re-add. Build is **tsc** (not SWC, despite SWC devDeps).
- `tsconfig` has `strictNullChecks` on but not full `strict` (`noImplicitAny: false`). Write code as if `strict` were on; do not rely on the looseness.
- `main.ts` is hardened (helmet, pino logger via `app.useLogger`, `enableShutdownHooks`) and invokes `void bootstrap();` to satisfy `no-floating-promises`.
