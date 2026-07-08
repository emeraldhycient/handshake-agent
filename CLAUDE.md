# CLAUDE.md

This file is the canonical guidance for Claude Code (and any AI agent) working anywhere in this repository. It is the constitution. Per-package `CLAUDE.md` files (`api/`, `web/`, `web-admin/`, `packages/contracts/`) add package-specific detail and never contradict this file.

> Read order for a new task: this file → the package `CLAUDE.md` for the area you're touching → [`docs/PRD.md`](docs/PRD.md) (§4 the agent architecture is mandatory before touching agent/transaction code) → [`docs/BRD.md`](docs/BRD.md).

---

## 1. Project overview

**Handshake Agent** — a chat-native assistant for the Nigerian market that lets users buy, sell, send, receive, and (later) swap crypto, and discover and buy event tickets, through natural-language conversation. WhatsApp and the web app are **both full agent surfaces**: a user can complete flows in either, including in-thread on WhatsApp via end-to-end-encrypted **WhatsApp Flows** (KYC, itemized confirmation, PIN). The **web app remains the system of record and full fallback**, and the same **server-side deterministic engine settles every transaction** in either channel (§3.1). See [`docs/adr/0003-whatsapp-full-agent-surface.md`](docs/adr/0003-whatsapp-full-agent-surface.md).

The defining property of this system is **safety of funds before convenience**: no language-model output ever moves money on its own. The model interprets intent; a separate deterministic engine executes — after explicit parameter confirmation, server-side validation, and PIN + step-up authentication. This is not a feature, it is the architecture. See [`docs/PRD.md`](docs/PRD.md) §4.

This is a **separate product** from the `handshake` escrow app in the sibling directory. It shares the brand and the engineering-quality philosophy, but none of its infrastructure (no Turnkey / Stellar / Trustless Work). This product is **custodial** via **Blockradar** (Wallet-as-a-Service; stablecoins on TRON/EVM) — USDT on TRON at launch, BTC deferred. See [`docs/adr/0006-provider-selections.md`](docs/adr/0006-provider-selections.md).

---

## 2. Repository layout (monorepo)

`pnpm` workspaces + Turborepo. Three apps at the root (no `apps/` nesting), shared libraries in `packages/`.

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
├── web-admin/               # Next.js 16 admin console (separate auth/store; reuses contracts)
└── packages/
    └── contracts/           # shared Zod schemas + inferred types (FE ⇄ BE ⇄ agent)
```

Workspace package names: `@handshake-agent/api`, `@handshake-agent/web`, `@handshake-agent/web-admin`, `@handshake-agent/contracts`. Filter by name (`pnpm --filter @handshake-agent/api …`) or by path (`pnpm --filter ./api …`).

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

The agent code (NLU + tool definitions) holds **no database credentials and no Prisma import**. It reaches data and capabilities only through injected ports (`LlmProvider`, `ToolGateway`). The generated Prisma client (`api/generated/prisma`) and the `PrismaService` wrapper (`api/src/core/prisma`) live only in `infrastructure`-layer repositories. This is enforced by `dependency-cruiser` (`.dependency-cruiser.cjs` forbids `@prisma/client`, the generated client, **and** `api/src/core/prisma` from `agent`/`application`/`domain`; the generated tree stays visible as a rule target via `doNotFollow`, never `exclude`), not just convention.

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

The 19 feature modules that exist today (`ls api/src/modules`):

- `admin` — operator-console backend: RBAC, immutable audit, maker-checker change requests, settings/config console, KYC review, transaction oversight, treasury ops, metrics
- `agent` — the embedded LangGraph agent (framework-agnostic core + ports + thin Nest adapter, §6)
- `auth` — email-OTP web sessions + JWTs, and personal access tokens (PATs) for the MCP surface
- `balances` — read-only portfolio snapshots for the agent surfaces
- `beneficiaries` — saved recipients (bank + crypto), name-enquiry, nickname resolution
- `chat` — web chat endpoints driving the agent (text + voice)
- `compliance` — sanctions/AML screening
- `config` — public `GET /config`: effective non-secret capability flags + catalog for the frontends
- `conversations` — conversation/message persistence (chat history)
- `identity` — users, KYC, devices
- `mcp` — PAT-authenticated stateless MCP endpoint; read + propose tools only (§6)
- `media` — speech-to-text transcription + document-extraction ports
- `notifications` — outbound email (Resend) + notification templates
- `quotes` — pricing/quoting (rates, spreads, fees)
- `transactions` — **the deterministic execution engine** (proposals → validation → PIN/step-up → settlement)
- `treasury` — fiat rails (Flutterwave): virtual accounts, payouts, float, large-payout approval
- `wallets` — custodial crypto via Blockradar: addresses, deposits, withdrawals, swaps
- `webhooks` — durable persist-first webhook queue (Blockradar / Flutterwave / WhatsApp)
- `whatsapp` — WhatsApp Cloud API surface: inbound, Flows, templates (§3.5)

`tickets` is still **future**: the ticketing capability exists only as a registry flag (`ticketing` in the layered config, surfaced read-side in the admin console) — no tickets module ships yet.

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

### The MCP surface — read + propose only

External AI clients (Claude Desktop, IDEs, other agents) connect via **`POST /mcp`** — a **stateless Streamable-HTTP** MCP endpoint (`api/src/modules/mcp/`). Authentication is by **personal access token only**: tokens are minted PIN-gated at `POST /profile/tokens`, prefixed `hsk_pat_`, stored **only as a SHA-256 hash** (raw value shown once), and carry scopes **`read`** and/or **`chat:propose`**. Session JWTs are rejected on `/mcp`, and PATs are rejected on the session surfaces — the two credential kinds never cross.

The §3.1 invariant applies unreduced: **MCP tools read data and create proposals only. No execute, authorize, or PIN surface exists over MCP** — there is deliberately no `chat:execute` scope, so a leaked PAT can never move money. Execution stays behind the signed directive + PIN + step-up flow on the web app and WhatsApp. Beneficiary **nicknames** follow the same rule everywhere the model runs: a nickname is a **server-resolved lookup key** against the user's own saved recipients — the model never extracts a wallet address, account number, or bank code as a destination.

---

## 7. Configuration — layered: DB-admin › env › code defaults

Three sources, merged with that precedence by a backend `ConfigService` (the DB-admin overlay resolves through `EffectiveConfigService`). **Nothing that should be tunable is hardcoded.**

1. **Code defaults** ([`api/src/core/config/configuration.ts`](api/src/core/config/configuration.ts), committed) — static baseline values and seed.
2. **Environment** (`.env`, validated by a Zod schema at boot — invalid env fails startup) — secrets and infrastructure (`DATABASE_URL`, `ANTHROPIC_API_KEY`, processor/WaaS keys, WhatsApp tokens). See [`api/.env.example`](api/.env.example).
3. **DB-admin settings** (`AppSetting` table, editable from the admin console, hot-reloaded with cache invalidation) — business-tunable values: FX spread, processing fees, ticketing commission, KYC-tier limits, velocity caps, message templates, and **service enablement flags**.

**Service / capability registry.** Each transactable capability (`crypto.buy`, `crypto.sell`, `send`, `swap`, `ticketing.<vendor>`) is registered behind a provider **port** and gated by an admin flag resolved from the layered config. Enabling a service = flip a flag. Adding a ticket vendor = implement the `TicketProvider` port and register it — no changes to callers. The frontend reads effective, non-secret flags from a `/config` endpoint (cached via TanStack Query) to show/hide services. This is how the product stays "extendable, easy to decide what to enable."

**Decision rule when adding a value:** secret or infra → env. Static default a developer sets → `configuration.ts`. Anything ops/admin should change without a deploy → DB-admin setting.

---

## 8. Shared contracts (`packages/contracts`)

One Zod schema, three consumers. Structured intents, tool I/O, and request/response DTOs are defined **once** as Zod schemas with types via `z.infer`. The frontend imports them (forms + Axios clients), the API validates with them (`nestjs-zod` `createZodDto` + global `ZodValidationPipe`), and the agent uses them as tool schemas. Never redefine a shape that already exists in `contracts`.

It is a **source-only** package (no build step): `exports` point at `src/*.ts`; the apps' toolchains transpile it. This means: Next needs `transpilePackages: ['@handshake-agent/contracts']`; the api Jest config needs a `moduleNameMapper` to the source (ts-jest does not honor `exports`); both apps add a tsconfig path alias. `zod` is a `peerDependency` so exactly one instance is installed. See [`packages/contracts/CLAUDE.md`](packages/contracts/CLAUDE.md).

---

## 9. Testing — strict TDD everywhere

TDD is **mandatory**, not aspirational. Red → Green → Refactor: write a failing test first, make it pass, then clean up.

- **~100% coverage on business logic** — domain, application services, the deterministic execution engine, quoting/limits/sanctions. The money path is non-negotiable.
- **Backend**: Jest + `@nestjs/testing` (unit config is the inline `jest` block in `api/package.json`; e2e is `api/test/jest-e2e.json` via `supertest`). Integration/e2e tests run against **real Postgres via `@testcontainers/postgresql`**, not mocks.
- **Frontend**: Vitest + React Testing Library + `@testing-library/user-event` (`test` / `test:watch`); Playwright for E2E (`test:e2e`). All installed and wired in both `web` and `web-admin`.
- **Contracts**: schemas are tested by parsing valid/invalid fixtures (Vitest).
- **What CI actually enforces:** lint, typecheck, `depcruise`, the **unit** suites (`turbo run test`), and build. Coverage is **reviewed** (`test:cov`), not threshold-gated — no `coverageThreshold` exists; the ~100%-on-money-path bar is held in review, not by a machine. **The api e2e/testcontainers lane (`pnpm --filter @handshake-agent/api test:e2e`, ~80 suites including the funds-safety verticals) runs locally only — it is NOT in CI.** Run it yourself before merging anything on the money path; a change is not done until unit + relevant e2e suites are green.

**Known flakes / known-red (don't rediscover these):**

- `web-admin` `admins-page.test.tsx` flakes under parallel `turbo` runs — rerun it in isolation before concluding a change broke it.
- The api Jest teardown warning ("worker process has failed to exit gracefully") is benign.
- Two e2e suites are known-red on `main` itself: send-vertical (velocity 6>5) and admin-end-users (tier) — pre-existing, not caused by your change.

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

## 11. Getting started

Dependencies **are installed** and the workspace is fully wired: the lockfile is committed, `@handshake-agent/contracts` is linked `workspace:*` into all three apps, and the transpile/alias/Jest-mapper plumbing is in place. Do **not** re-run any bootstrap (`prisma init`, `pnpm add` of the base stack) — for a fresh clone or worktree this is the whole setup:

```bash
corepack use pnpm@10.25.0                                  # match the pinned package manager
pnpm install                                               # install + link the workspace (runs husky via "prepare")
pnpm --filter @handshake-agent/api exec prisma generate    # generated client (api/generated/prisma) is gitignored
cp api/.env.example api/.env                               # then fill in keys — Zod-validated at boot
```

Local infra matches the visual-verification runbook (`web/CLAUDE.md`): Docker Postgres `handshake-agent-db` on host **:5544** and Redis `handshake-agent-redis` on **:6379** — point `DATABASE_URL` at your Postgres (the `.env.example` default says `:5432`; the standing dev containers use `:5544`), then apply migrations with `pnpm --filter @handshake-agent/api exec prisma migrate dev`. Worktrees need their **own** `pnpm install` + copied `api/.env`, and a re-run of `prisma generate` after rebasing any schema change.

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
- **Deployment:** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (three apps + the worker process, env reference, go-live checklist) · [`docs/RAILWAY.md`](docs/RAILWAY.md)
- **Operational runbooks:** [`docs/runbooks/`](docs/runbooks/) — adding assets/networks, WhatsApp staging flows.
- **Security audit:** [`docs/security-audit-2026-07-04.md`](docs/security-audit-2026-07-04.md)
- **Program specs:** [`docs/superpowers/specs/`](docs/superpowers/specs/) — e.g. the go-live program ([`2026-07-08-go-live-program-design.md`](docs/superpowers/specs/2026-07-08-go-live-program-design.md)).
- **Package guides:** [`api/CLAUDE.md`](api/CLAUDE.md) · [`web/CLAUDE.md`](web/CLAUDE.md) · [`web-admin/CLAUDE.md`](web-admin/CLAUDE.md) · [`packages/contracts/CLAUDE.md`](packages/contracts/CLAUDE.md)

---

## 16. Componentisation & modularisation (FE — web + web-admin)

The rails that keep pages small and reusable. Applies to `web` and `web-admin`. Sits on top of §4.2 (layering) and §13 (code quality). A violation is drift — surface it (§13 "Surfacing drift"), don't add to it.

1. **Pages / route files are orchestrators only.** A `page.tsx` (or a top-level view) holds data hooks, the four async branches (loading/error/empty/data), event handlers, and composition of section components — **no large inline section markup**. Extract each section (hero, table, list, toolbar, dialog) into its own component in `components/<feature>/`.
2. **No component may masquerade as a page.** A page lives in `app/`. A reusable view/section lives in `components/<feature>/`. Do not create `*-page.tsx` components that are really views — name them for what they are.
3. **Tabular data renders through the `Table` primitive via `shared/DataTable`.** No raw `<table>`, no div-grid "tables". `DataTable` is column-config driven (`columns`, `rows`, `getRowKey`, `ariaLabel`, optional `hideHeader` / `empty`); every table has an `ariaLabel`. Column configs that contain JSX renderers live in the section file (see rule 5).
4. **Hooks live in `hooks/`.** Never a `useXxx` defined inside a component file.
5. **Constants live in `constants/`** (per-feature files, named exports). No magic array / label-map / enum-of-labels inline in a component. A column _config_ that imports components stays in the section file so `constants/` never imports from `components/`.
6. **Types live in `types/`** — per-feature files (`types/<feature>.ts`) plus a `types/index.ts` barrel (import from `@/types`). Prop types are `XxxProps` (§13.4); shared/domain shapes come from `@handshake-agent/contracts`. No inline interfaces beyond trivial locals.
7. **Size caps (from §13.3):** component ≤150 lines, file ≤300, function ≤40. Extract at the section boundary, not every element — a cohesive block stays one file.

Enforcement: `.dependency-cruiser.cjs` carries explicit rules for both apps — `components ↛ app`, `lib ↛ components`, and `hooks`/`constants`/`types` ↛ `components`/`app` — plus cross-app isolation (`web`, `web-admin`, and `api` never import each other; shared shapes live in `packages/contracts`). Every FE wave ends on `pnpm lint && pnpm typecheck && pnpm test` green and `pnpm depcruise` clean, plus a visual check of any affected surface (see `web/CLAUDE.md` → Visual verification runbook). Program spec: [`docs/superpowers/specs/2026-07-06-componentisation-modularisation-design.md`](docs/superpowers/specs/2026-07-06-componentisation-modularisation-design.md).
