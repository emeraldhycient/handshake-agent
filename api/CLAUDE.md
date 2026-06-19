# api — CLAUDE.md

NestJS 11 backend: the system of record, the deterministic execution engine, the typed tool layer, and the embedded LangGraph agent. Read the root [`CLAUDE.md`](../CLAUDE.md) first — its invariants (§3) and clean-architecture rules (§4) are binding here. This file adds backend specifics.

## Architecture — feature modules, layered inside

```
src/
├── main.ts                 # bootstrap: helmet, pino logger, global ZodValidationPipe, shutdown hooks
├── app.module.ts           # composition root: ConfigModule (global), feature modules, APP_PIPE
├── core/                   # cross-cutting
│   ├── config/             # @nestjs/config: JSON defaults + zod-validated env → typed ConfigService
│   ├── logging/            # nestjs-pino
│   ├── prisma/             # PrismaService ($connect onModuleInit, enableShutdownHooks)
│   ├── auth/               # PIN, step-up, device binding, sessions
│   └── common/             # filters, interceptors, guards (throttler), decorators
└── modules/<feature>/
    ├── domain/             # entities, value objects, enums, domain errors — PURE
    ├── application/        # use-case services + ports (interfaces) + app DTOs
    ├── infrastructure/     # Prisma repositories + external clients implementing ports
    └── presentation/       # controllers + request/response DTOs (nestjs-zod)
```

**Dependency rule (enforced by `dependency-cruiser`):** `presentation → application → domain`; `infrastructure` implements `application` ports. `application` must never import `infrastructure` or `@prisma/client`. `domain` imports nothing framework-specific.

## Prisma — the only door to the database

This is **Prisma 7** (`@prisma/client` ^7). It uses the new `prisma-client` generator: the client is generated into `api/generated/prisma` (gitignored, regenerate with `prisma generate`), and config lives in `api/prisma.config.ts` (schema path, migrations path, `datasource.url` from `DATABASE_URL`). The schema is at `api/prisma/schema.prisma`.

- **Only `infrastructure`-layer repositories import the generated client** (from `api/generated/prisma`) or inject `PrismaService`. Controllers, application/domain services, DTOs, and the agent must not. `dependency-cruiser` forbids importing `api/generated/prisma` or `@prisma/client` from `application`/`domain`/`agent` — this realizes root-`CLAUDE.md` §3.2.
- Wrap the client in a `PrismaService` (`onModuleInit` → `$connect`; call `app.enableShutdownHooks()` in `main.ts`). Inject it only into repositories.
- pnpm 10 blocks Prisma's engine build script by default; the root `package.json` `pnpm.onlyBuiltDependencies` allowlist re-enables it. Run `prisma generate` before any code imports the client.

```bash
pnpm --filter @handshake-agent/api exec prisma migrate dev --name <name>   # dev: migrate + generate
pnpm --filter @handshake-agent/api exec prisma generate                    # regenerate client
pnpm --filter @handshake-agent/api exec prisma migrate deploy              # CI/prod: apply, no prompt
```

## Validation, config, logging

- **Validation:** `nestjs-zod`. Wrap shared schemas from `@handshake-agent/contracts` with `createZodDto`; register `ZodValidationPipe` globally via `APP_PIPE`. Do not redefine request shapes — import them. Server-side validation is security, not UX (root §3.3).
- **Config (layered DB › env › JSON, root §7):** `ConfigModule.forRoot({ isGlobal: true, load: [defaults], validate: (raw) => envSchema.parse(raw) })`. Invalid env fails boot. Read via a typed `ConfigService<Env, true>`. Admin-tunable values resolve from the DB `AppSetting` layer on top.
- **Logging:** `nestjs-pino`, set as the Nest logger (`app.useLogger(app.get(Logger))`, `bufferLogs: true`). `pino-pretty` in dev only; raw JSON in prod.

## The agent module (`modules/agent/`)

LangGraph.js **v1** (`@langchain/langgraph@1.4.4`, `@langchain/core@1.2.0`, `@langchain/anthropic@1.5.0`). See root [`CLAUDE.md`](../CLAUDE.md) §6.

- Agent **core** is framework-agnostic — imports only `zod`, `@langchain/core` types, and the `LlmProvider` + `ToolGateway` ports. **No Nest, no concrete services, no `@prisma/client`** (dependency-cruiser enforces this).
- `ChatAnthropic` appears **only** in the `LlmProvider` adapter. Default model id: `claude-opus-4-8`; `ANTHROPIC_API_KEY` from env.
- The graph **emits a validated intent** (`model.withStructuredOutput(IntentSchema)` from `@handshake-agent/contracts`); it executes nothing. Side-effecting tools build proposals for the deterministic engine.
- Do not instantiate a checkpointer here (would re-couple to the DB). Keep the `ToolGateway` binding swappable for later extraction to a standalone service.
- ESM-under-CJS: always `import` these packages (tsc downlevels); never hand-write `require()`.

## Commands

```bash
pnpm --filter @handshake-agent/api start:dev    # watch mode
pnpm --filter @handshake-agent/api build        # tsc build (nest build)
pnpm --filter @handshake-agent/api lint         # flat-config ESLint (auto-fix)
pnpm --filter @handshake-agent/api typecheck    # tsc --noEmit
pnpm --filter @handshake-agent/api test         # jest unit (config inline in package.json)
pnpm --filter @handshake-agent/api test:e2e     # supertest e2e (test/jest-e2e.json)
pnpm --filter @handshake-agent/api test:cov     # coverage
```

## Testing (strict TDD, root §9)

Red → Green → Refactor. ~100% coverage on `domain` + `application` + the execution engine. Unit test config is the inline `jest` block in `package.json` (`*.spec.ts`, `rootDir: src`); e2e is `test/jest-e2e.json` (`*.e2e-spec.ts`). Integration tests use `@testcontainers/postgresql` against real Postgres — not mocks. The contracts `moduleNameMapper` is already wired into the Jest config so shared schemas resolve.

## Stack gotchas (verified)

- NestJS `11.1.27`, **Express 5** underneath: wildcard routes use `/*splat` syntax; query parsing differs from Express 4. `ThrottlerModule` is v6-style (named throttlers array, ttl in **ms**).
- `reflect-metadata` and `rxjs` are already installed — do not re-add. Build is **tsc** (not SWC, despite SWC devDeps).
- `tsconfig` has `strictNullChecks` on but not full `strict` (`noImplicitAny: false`). Write code as if `strict` were on; do not rely on the looseness.
- `main.ts` is hardened (helmet, pino logger via `app.useLogger`, `enableShutdownHooks`) and invokes `void bootstrap();` to satisfy `no-floating-promises`.
