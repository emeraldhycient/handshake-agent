# CLAUDE.md

This file is the canonical guidance for Claude Code (and any AI agent) working anywhere in this repository. It is the constitution. Per-package `CLAUDE.md` files (`api/`, `web/`, `packages/contracts/`) add package-specific detail and never contradict this file.

> Read order for a new task: this file → the package `CLAUDE.md` for the area you're touching → [`docs/PRD.md`](docs/PRD.md) (§4 the agent architecture is mandatory before touching agent/transaction code) → [`docs/BRD.md`](docs/BRD.md).

---

## 1. Project overview

**Handshake Agent** — a chat-native assistant for the Nigerian market that lets users buy, sell, send, receive, and (later) swap crypto, and discover and buy event tickets, through natural-language conversation. WhatsApp and the web app are **both full agent surfaces**: a user can complete flows in either, including in-thread on WhatsApp via end-to-end-encrypted **WhatsApp Flows** (KYC, itemized confirmation, PIN). The **web app remains the system of record and full fallback**, and the same **server-side deterministic engine settles every transaction** in either channel (§3.1). See [`docs/adr/0003-whatsapp-full-agent-surface.md`](docs/adr/0003-whatsapp-full-agent-surface.md).

The defining property of this system is **safety of funds before convenience**: no language-model output ever moves money on its own. The model interprets intent; a separate deterministic engine executes — after explicit parameter confirmation, server-side validation, and PIN + step-up authentication. This is not a feature, it is the architecture. See [`docs/PRD.md`](docs/PRD.md) §4.

This is a **separate product** from the `handshake` escrow app in the sibling directory. It shares the brand and the engineering-quality philosophy, but none of its infrastructure (no Turnkey / Stellar / Trustless Work). This product is **custodial** via **Blockradar** (Wallet-as-a-Service; stablecoins on TRON/EVM) — USDT on TRON at launch, BTC deferred. See [`docs/adr/0006-provider-selections.md`](docs/adr/0006-provider-selections.md).

---

## 2. Repository layout (monorepo)

`pnpm` workspaces + Turborepo. Two apps at the root (no `apps/` nesting), shared libraries in `packages/`.

```
handshake-agent/
├── CLAUDE.md                # this file — canonical
├── AGENTS.md                # pointer for non-Claude agents → CLAUDE.md
├── package.json             # root workspace + turbo task graph
├── pnpm-workspace.yaml      # workspace globs: api, web, packages/*
├── turbo.json               # turbo 2.x task graph (uses "tasks", not "pipeline")
├── commitlint.config.cjs · .lintstagedrc.cjs · .dependency-cruiser.cjs
├── .husky/                  # pre-commit, commit-msg, pre-push
├── .github/workflows/ci.yml
├── docs/                    # BRD, PRD, Investor-Memo, adr/
├── api/                     # NestJS 11 backend (was handshake-agent-be)
├── web/                     # Next.js 16 frontend (was handshake-agent-fe)
└── packages/
    └── contracts/           # shared Zod schemas + inferred types (FE ⇄ BE ⇄ agent)
```

Workspace package names: `@handshake-agent/api`, `@handshake-agent/web`, `@handshake-agent/contracts`. Filter by name (`pnpm --filter @handshake-agent/api …`) or by path (`pnpm --filter ./api …`).

> New to this layout? [`docs/monorepo.md`](docs/monorepo.md) explains the workspace model: per-package installs, the `workspace:*` shared-package linking, and per-consumer wiring — with a worked example.

---

## 3. Sacrosanct invariants

These are hard rules. Code that violates one is a **security bug**, not a style issue. They mirror the PRD's safety-critical design (§4) and compliance requirements (§6).

### 3.1 The model proposes, the engine disposes

No LLM output moves money. The system is three layers (see §6):

1. **NLU layer** (LangGraph + Claude) — produces a **validated structured-intent object**, never a transaction, address, or final amount that is acted on directly. Model free-text is **never** treated as a financial parameter.
2. **Typed tool layer** — the agent's only capability surface. Read-only tools return data; **side-effecting tools create a proposal, they never execute.**
3. **Deterministic execution engine** — the only component that constructs and submits real transactions. For every proposal it re-validates against schemas/live pricing/KYC-tier limits, runs balance + velocity + sanctions + AML checks, renders the **exact itemized parameters** for explicit confirmation, requires **PIN + step-up**, and executes with an **idempotency key**.

### 3.2 The agent never touches the database

The agent code (NLU + tool definitions) holds **no database credentials and no Prisma import**. It reaches data and capabilities only through injected ports (`LlmProvider`, `ToolGateway`). `@prisma/client` lives only in `infrastructure`-layer repositories. This is enforced by `dependency-cruiser` (`.dependency-cruiser.cjs`), not just convention.

### 3.3 KYC gating is server-side first

Every money-moving endpoint re-checks KYC status, tier limits, velocity, and sanctions **server-side**. The frontend gate is UX; the backend gate is security. A backend endpoint that trusts the frontend is a vulnerability.

### 3.4 Identity is not the phone number

Account identity and authorization are anchored to verified KYC + a bound device + a user-set PIN — never the WhatsApp phone number alone (SIM-swap risk). A SIM/number change triggers re-verification + step-up.

### 3.5 WhatsApp is a full agent surface, settled by the engine

WhatsApp is a first-class agent surface, not a handoff-only funnel: users complete flows **in-thread** via the official WhatsApp Cloud API + **WhatsApp Flows** (Meta's end-to-end-encrypted in-chat forms) for KYC, itemized confirmation, and PIN entry. But the model still only proposes and the **same server-side deterministic engine still settles** (§3.1) — WhatsApp collects intent + authorization; the engine executes. Meta's Commerce Policy prohibits crypto as in-thread _commerce_, so WhatsApp must **never** present a crypto Catalog/Cart/WhatsApp-Pay object or complete a crypto payment as a WhatsApp _commerce_ transaction — settlement is **engine-brokered server-side**. Use **only** the official Cloud API + Flows + approved templates; no unofficial automation (a ban trigger). PIN/KYC secrets travel **only** via Flow E2E encryption, never as plaintext chat. The web app stays the system of record and full fallback. See [`docs/adr/0003-whatsapp-full-agent-surface.md`](docs/adr/0003-whatsapp-full-agent-surface.md).

### 3.6 No shortcuts

No placeholder implementations, no `TODO` for incomplete code (a `TODO(TICKET-123): …` with a reference is fine), no hardcoded values that should be configurable (keys, URLs, fees, limits → see §7). Complete the full implementation before marking work done.

---

## 4. Clean architecture

Dependencies always point **inward / downward**. Boundaries are enforced by `dependency-cruiser` and ESLint, and verified in CI.

### 4.1 Backend (`api/`, NestJS) — feature modules, layered inside

```
api/src/
├── core/        # config, logging, auth (pin/step-up/device), filters, guards, pipes, prisma service
├── modules/<feature>/
│   ├── domain/          # entities, value objects, enums, domain errors — pure. NO Nest, NO Prisma.
│   ├── application/     # use-case services + PORTS (interfaces) + app DTOs
│   ├── infrastructure/  # Prisma repositories + external clients that IMPLEMENT the ports
│   └── presentation/    # controllers, request/response DTOs (nestjs-zod), validation
```

Dependency rule: `presentation → application → domain`. `infrastructure` implements `application` ports and may import `domain`. **`application` must never import `infrastructure` or `@prisma/client`.** Services inject port interfaces (e.g. `IWalletRepository`, `ITurnkeyClient`), never concrete repositories or the DB client.

Planned feature modules: `identity` (users/KYC/devices), `wallets`, `quotes`, `transactions` (the execution engine), `beneficiaries`, `tickets`, `compliance` (KYC/sanctions/AML/Travel Rule), `treasury`, `notifications`, `whatsapp`, `admin` (config console), `agent`.

### 4.2 Frontend (`web/`, Next.js) — strict downward layering

```
web/
├── app/          # routes + composition only. Arranges components, passes props. No new primitives.
├── components/
│   ├── ui/       # shadcn primitives (generated). One canonical primitive per concept.
│   ├── shared/   # cross-cutting composed primitives
│   └── <feature>/# feature components (chat, wallet, kyc, tickets)
├── lib/          # the ONLY layer that talks to the world: api clients, query hooks, stores, schemas, helpers
├── hooks/
└── types/        # every interface/type declaration (or re-exports of contracts' inferred types)
```

Imports flow strictly down: `app/ → components/ → lib/ → types/`. **`components/` must not import from `app/`; `lib/` must not import from `components/`.** Components are pure UI — no `fetch`, no `localStorage`, no business logic; lift those into `lib/` hooks.

---

## 5. State, data, and validation (frontend)

Each tool has exactly one job — do not blur them:

- **TanStack Query** owns **all server state** (queries + mutations). Never `useEffect` + `fetch`. Set a sensible `staleTime` per resource.
- **Zustand** owns **client/UI state only** (chat composer, modal open-state, view prefs). Never a server cache.
- **Axios** is the single HTTP client — one configured instance in `lib/api/` with interceptors (auth, error normalization, `Idempotency-Key` on every mutation).
- **Zod + react-hook-form** for every form (`@hookform/resolvers/zod`). Schemas come from `@handshake-agent/contracts` where they mirror a request DTO. **Every API client parses its body through the Zod schema before the request fires**, and parses the response after. The frontend gate is UX, never the only check (§3.3).
- **shadcn + Tailwind v4** for UI. Tokens only — no hex literals; status semantics are fixed (`success`/`warn`/`danger`/`info`/neutral). Every async UI has four branches: loading / error / empty / data.

---

## 6. The agent (LangGraph) — embedded now, extractable later

The agent lives in `api/src/modules/agent/` today (one deployable) but is built so it can be lifted into a standalone service with **zero rewrite** — only a binding swap.

- The **agent core** is framework-agnostic: it imports `zod`, `@langchain/core` types, and two **ports** — `LlmProvider` (hides `ChatAnthropic`) and `ToolGateway` (hides transport + execution). It imports **zero** Nest symbols, **zero** concrete services, and **zero** `@prisma/client`.
- A thin Nest `@Injectable` wires the ports via DI tokens. The `ToolGateway` binding is an in-process adapter today (calls application services); extraction = swap it for an HTTP/gRPC client adapter.
- The graph **emits a validated structured-intent object** (`model.withStructuredOutput(IntentSchema)`), it does not execute. Tool/intent schemas live in `@handshake-agent/contracts`.
- LLM default model id: **`claude-opus-4-8`** (most capable latest), via `@langchain/anthropic`, `ANTHROPIC_API_KEY` from env.
- Do **not** wire a checkpointer (`MemorySaver`/`PostgresSaver`) into the embedded agent — that would re-couple it to the DB and break extraction. If human-in-the-loop is needed, keep it in the calling layer or inject a checkpointer port.

LangGraph.js is **v1** (`@langchain/langgraph@1.4.4`, `@langchain/core@1.2.0`, `@langchain/anthropic@1.5.0`). v0 tutorials are stale. The packages are ESM-first; under Nest's CommonJS + ts-jest, always use `import` statements (tsc downlevels them) — never hand-write `require()` for them. Pin `zod` to `^3.25.32` (LangGraph's floor) directly in `api`, `web`, and `contracts` so our code resolves one instance — two copies across the boundary cause silent `ZodType` identity bugs. The `zod@4` that tooling (`eslint-plugin-react-hooks`, the `shadcn` CLI) pulls in is isolated under those packages and is fine; do **not** add a global `pnpm.overrides` for zod.

---

## 7. Configuration — layered: DB-admin › env › JSON

Three sources, merged with that precedence by a backend `ConfigService`. **Nothing that should be tunable is hardcoded.**

1. **JSON defaults** (`api/config/defaults/*.json`, committed) — static baseline values and seed.
2. **Environment** (`.env`, validated by a Zod schema at boot — invalid env fails startup) — secrets and infrastructure (`DATABASE_URL`, `ANTHROPIC_API_KEY`, processor/WaaS keys, WhatsApp tokens). See [`api/.env.example`](api/.env.example).
3. **DB-admin settings** (`AppSetting` table, editable from the admin console, hot-reloaded with cache invalidation) — business-tunable values: FX spread, processing fees, ticketing commission, KYC-tier limits, velocity caps, message templates, and **service enablement flags**.

**Service / capability registry.** Each transactable capability (`crypto.buy`, `crypto.sell`, `send`, `swap`, `ticketing.<vendor>`) is registered behind a provider **port** and gated by an admin flag resolved from the layered config. Enabling a service = flip a flag. Adding a ticket vendor = implement the `TicketProvider` port and register it — no changes to callers. The frontend reads effective, non-secret flags from a `/config` endpoint (cached via TanStack Query) to show/hide services. This is how the product stays "extendable, easy to decide what to enable."

**Decision rule when adding a value:** secret or infra → env. Static default a developer sets → JSON. Anything ops/admin should change without a deploy → DB-admin setting.

---

## 8. Shared contracts (`packages/contracts`)

One Zod schema, three consumers. Structured intents, tool I/O, and request/response DTOs are defined **once** as Zod schemas with types via `z.infer`. The frontend imports them (forms + Axios clients), the API validates with them (`nestjs-zod` `createZodDto` + global `ZodValidationPipe`), and the agent uses them as tool schemas. Never redefine a shape that already exists in `contracts`.

It is a **source-only** package (no build step): `exports` point at `src/*.ts`; the apps' toolchains transpile it. This means: Next needs `transpilePackages: ['@handshake-agent/contracts']`; the api Jest config needs a `moduleNameMapper` to the source (ts-jest does not honor `exports`); both apps add a tsconfig path alias. `zod` is a `peerDependency` so exactly one instance is installed. See [`packages/contracts/CLAUDE.md`](packages/contracts/CLAUDE.md).

---

## 9. Testing — strict TDD everywhere

TDD is **mandatory**, not aspirational. Red → Green → Refactor: write a failing test first, make it pass, then clean up.

- **~100% coverage on business logic** — domain, application services, the deterministic execution engine, quoting/limits/sanctions. The money path is non-negotiable.
- **Backend**: Jest + `@nestjs/testing` (unit config is the inline `jest` block in `api/package.json`; e2e is `api/test/jest-e2e.json` via `supertest`). Integration tests run against **real Postgres via `@testcontainers/postgresql`**, not mocks.
- **Frontend**: Vitest + React Testing Library + `@testing-library/user-event`; Playwright for E2E. (To be installed — see §11.)
- **Contracts**: schemas are tested by parsing valid/invalid fixtures.
- CI enforces coverage gates per package. A change is not done until tests are green and coverage holds.

---

## 10. Tooling & commands

The active package manager is **pnpm `10.25.0`** (pinned via `packageManager`). Turborepo orchestrates tasks across the workspace with caching. Use an **LTS Node** (`^20.12 || ^22 || >=24`): Node 23 is non-LTS and `dependency-cruiser` refuses to run on it, so the `depcruise` boundary gate fails locally on 23 — CI uses Node 22. pnpm 10 blocks dependency build scripts by default; the approved set (Prisma engine, sharp, swc, testcontainers natives) is allowlisted in the root `package.json` `pnpm.onlyBuiltDependencies`.

```bash
# from the repo root — turbo fans out to every workspace that defines the task
pnpm install                 # install + link the workspace (run this first; see §11)
pnpm build                   # turbo run build
pnpm lint                    # turbo run lint
pnpm typecheck               # turbo run typecheck
pnpm test                    # turbo run test
pnpm format                  # prettier --write (resolves each package's own config)
pnpm depcruise               # dependency-cruiser boundary check (clean-arch rules)

# scope to one package (by name or by path)
pnpm --filter @handshake-agent/web dev        # Next dev (Turbopack default in Next 16)
pnpm --filter @handshake-agent/api start:dev  # Nest watch mode
pnpm --filter @handshake-agent/api test:e2e   # backend e2e (supertest)
```

Quality gates are wired through Git hooks (Husky v9): **pre-commit** runs `lint-staged` (eslint --fix + prettier on staged files), **commit-msg** runs `commitlint` (Conventional Commits — `feat(api): …`, `fix(web): …`, `chore: …`), **pre-push** runs `pnpm turbo run typecheck test` across the workspace. Architecture boundaries are enforced by `dependency-cruiser` in CI.

> Stack-specific commands and gotchas live in the package docs: [`api/CLAUDE.md`](api/CLAUDE.md), [`web/CLAUDE.md`](web/CLAUDE.md), [`packages/contracts/CLAUDE.md`](packages/contracts/CLAUDE.md).

---

## 11. Bootstrapping (one-time activation)

The repo was restructured into a monorepo; the workflow files are committed but dependencies are **not yet installed**. Run these once to activate. Commands use the scoped package names — adjust if names differ.

```bash
# 0. from the repo root
corepack use pnpm@10.25.0      # match the pinned package manager
pnpm install                   # installs root devDeps + links workspaces; runs husky via "prepare"
# Commit the generated pnpm-lock.yaml — CI's `pnpm install --frozen-lockfile` depends on it.

# 1. backend libraries (api) — zod pinned to the LangGraph floor / single workspace line
pnpm --filter @handshake-agent/api add @prisma/client @nestjs/config nestjs-zod zod@^3.25.32 \
  nestjs-pino pino pino-http @nestjs/axios axios @nestjs/throttler helmet \
  @langchain/langgraph@1.4.4 @langchain/core@1.2.0 @langchain/anthropic@1.5.0
pnpm --filter @handshake-agent/api add -D prisma pino-pretty @testcontainers/postgresql
pnpm --filter @handshake-agent/api exec prisma init --datasource-provider postgresql   # schema → api/prisma/

# 2. frontend libraries (web)
pnpm --filter @handshake-agent/web add @tanstack/react-query zustand axios zod@^3.25.32 react-hook-form @hookform/resolvers
pnpm --filter @handshake-agent/web add -D vitest @testing-library/react @testing-library/jest-dom \
  @testing-library/user-event jsdom @vitejs/plugin-react @playwright/test

# 3. link the shared contracts package into both apps
pnpm --filter @handshake-agent/api add @handshake-agent/contracts@workspace:*
pnpm --filter @handshake-agent/web add @handshake-agent/contracts@workspace:*
```

The shared-contracts wiring is **already applied** in this repo: `web/next.config.ts` (`transpilePackages`), the `@handshake-agent/contracts` path alias in both `api/tsconfig.json` and `web/tsconfig.json`, and the api Jest `moduleNameMapper`. Remaining manual steps after install:

- Commit `pnpm-lock.yaml` (CI depends on it).
- Add a `test` script to `web/package.json` (Vitest) so the `turbo test` gate covers the frontend — `api` already has `test` + `typecheck`.
- Optional: set `outputFileTracingRoot` in `web/next.config.ts` to silence the monorepo multi-lockfile warning.

---

## 12. Stack versions & "this is not the X you know"

Grounded against what is actually installed (verified). When in doubt, read the package's bundled docs, not training data.

**Frontend** — Next `16.2.6`, React `19.2.4`, Tailwind `4.3.1`, shadcn `4.11.0`, `radix-ui` (unified) `1.6.0`.

- Next 16 uses **Turbopack by default** for `dev` and `build` — no `--turbopack` flag. `next lint` was **removed**; linting is the flat-config ESLint CLI.
- Request APIs are **async**: `cookies()`, `headers()`, `draftMode()`, and route `params`/`searchParams` are **Promises** — `await` them. `middleware` is deprecated (renamed `proxy`).
- Tailwind v4 is **CSS-first**: all config is in `web/app/globals.css` (`@import "tailwindcss"`, `@theme inline`, `@custom-variant dark`, oklch vars). **There is no `tailwind.config.js` — do not create one.** The only PostCSS plugin is `@tailwindcss/postcss`.
- `radix-ui` is the **unified** package: `import { Slot } from "radix-ui"` — never add individual `@radix-ui/react-*` packages. Add components with `cd web && pnpm dlx shadcn@latest add <name>` (style `radix-vega`; lands in `components/ui`).
- The web `web/AGENTS.md` instructs reading `node_modules/next/dist/docs/` before writing Next-specific code. Heed it.

**Backend** — NestJS `11.1.27`, TypeScript `5.9.3`, Express **5** under the hood. `reflect-metadata` and `rxjs` are already installed (don't re-add). Build is **tsc** (not SWC, despite SWC devDeps). `tsconfig` has `strictNullChecks` on but not full `strict` — write code as if `strict` were on. `ThrottlerModule` is v6-style (named throttlers, ttl in ms). Wildcard routes use Express 5 syntax (`/*splat`). Database is **Prisma 7** (`@prisma/client` `^7.8.0`): the new `prisma-client` generator emits to `api/generated/prisma` (gitignored) and config lives in `api/prisma.config.ts` — import the generated client only in `infrastructure`.

---

## 13. Code quality standards (repo-wide, FE + BE)

These apply everywhere and sit on top of §1–12.

1. **One canonical primitive per concept.** Buttons through the `Button`, modals through the modal primitive, DTO validation through `nestjs-zod`, HTTP through the single Axios instance. Need a variant? Extend the primitive — don't fork it.
2. **DRY — three is a pattern.** Two similar blocks: leave them. Three: extract a helper/hook/sub-component. Repeated literals → named constants. Repeated shapes → `packages/contracts`.
3. **KISS.** Plain TypeScript first; justify every new dependency. Soft caps: functions ≤ 40 lines, components/classes ≤ 150 lines, files ≤ 300 lines — past these, split before adding more. Prefer early returns over deep nesting.
4. **Types are centralized, never inline.** Component prop types are `XxxProps` in `web/types/`. Domain/contract shapes are imported from `@handshake-agent/contracts`, not redefined. No `any` without a one-line comment explaining the boundary it crosses.
5. **Readability.** Self-documenting names (no `data`, `tmp`, `manager`, `processor` unless unmistakable). Comments explain **why**, not **what**. Imports grouped: external → workspace/aliased → relative → `import type` last. No commented-out code, no leftover `console.log`, no unused imports.
6. **Every async path handles failure.** Four branches on the frontend (loading/error/empty/data). Never `try { } catch {}` to silence errors — surface them. Validate external/user input at the boundary; trust internal types after.
7. **Performance with intent.** `useMemo`/`useCallback` only when they earn it. Stable list keys (ids, never array index). Lazy-load heavy modals/charts. Debounce filtering/search inputs (≥ 200ms). Sensible TanStack Query `staleTime`.
8. **Accessibility is a blocker.** Visible focus states, `aria-label` on icon buttons, focus-trapped modals that close on Esc, `prefers-reduced-motion` honored, color never the sole signal.

### Surfacing drift

When you find code that violates these standards (inline types, hardcoded values that should be config, hand-rolled validation, missing async branches, a fork of an existing primitive), **surface it** — don't silently fix unrelated files (scope creep) and don't silently ignore it (decay). Fix in scope only if it's in a file you're already editing and the fix is small; otherwise aggregate findings into a "Drift found" list at the end of your response for the user to triage.

---

## 14. Task completion checklist

Before marking any task complete:

- [ ] TDD followed (test written first, red → green → refactor)
- [ ] Unit tests pass; ~100% coverage on touched business logic
- [ ] Integration tests pass (real Postgres via Testcontainers where applicable)
- [ ] **The model-proposes / engine-disposes invariant is preserved** (§3.1) — no LLM output moves money
- [ ] **The agent has no DB access** (§3.2) — `dependency-cruiser` passes
- [ ] Server-side KYC/limit/sanctions gate present on every money-moving endpoint (§3.3)
- [ ] No hardcoded values that belong in config (§7)
- [ ] Shapes that cross FE/BE come from `@handshake-agent/contracts` (§8)
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green; `pnpm depcruise` clean
- [ ] Conventional Commit message; one coherent change per commit

---

## 15. Documentation

- **Product requirements:** [`docs/PRD.md`](docs/PRD.md) — the agent architecture (§4) is authoritative; read before touching agent/transaction code.
- **Business requirements:** [`docs/BRD.md`](docs/BRD.md)
- **Investor memo:** [`docs/Investor-Memo.md`](docs/Investor-Memo.md)
- **Architecture decisions:** [`docs/adr/`](docs/adr/) — record significant decisions as numbered ADRs.
- **Monorepo guide:** [`docs/monorepo.md`](docs/monorepo.md) — workspace model, per-package installs, shared-contracts linking, worked example.
- **Package guides:** [`api/CLAUDE.md`](api/CLAUDE.md) · [`web/CLAUDE.md`](web/CLAUDE.md) · [`packages/contracts/CLAUDE.md`](packages/contracts/CLAUDE.md)
