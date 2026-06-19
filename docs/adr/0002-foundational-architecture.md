# 2. Foundational architecture: monorepo, embedded-but-decoupled agent, layered config, strict TDD

Date: 2026-06-18

## Status

Accepted

## Context

Handshake Agent is a money-moving, chat-native product (PRD §4) built from two pre-existing scaffolds — a NestJS backend and a Next.js frontend — that each started as their own git repo. We needed to decide how the codebase is organized, where the LangGraph agent runs given the hard rule that it must never touch the database directly, how configuration is sourced, and how strict the testing discipline is.

## Decision

1. **Single monorepo** (`pnpm` workspaces + Turborepo). The two scaffolds become `api/` and `web/` at the root (no `apps/` nesting); shared code lives in `packages/`. The nested git repos were removed in favour of one root repo.
2. **Shared contracts package** (`packages/contracts`, source-only) holds Zod schemas + inferred types as the single source of truth across frontend, backend, and agent.
3. **Agent embedded in NestJS now, decoupled for later extraction.** The LangGraph agent lives in `api/src/modules/agent/` but its core depends only on injected ports (`LlmProvider`, `ToolGateway`) — no Nest, no concrete services, no `@prisma/client`. Extraction to a standalone service later is a binding swap, not a rewrite. The agent reaches data and side effects only through the typed tool layer; the deterministic execution engine is the only component that moves money.
4. **Layered configuration: DB-admin › env › JSON.** Admin-tunable business values (fees, limits, service-enablement flags) live in the DB and are hot-reloadable; secrets/infra live in env (validated at boot); static defaults live in JSON.
5. **Strict TDD everywhere** (red → green → refactor, ~100% coverage on business logic), with integration tests against real Postgres via Testcontainers.

## Consequences

- The DB-isolation guarantee for the agent is enforced mechanically by `dependency-cruiser`, not just by convention.
- Turborepo caches lint/typecheck/test/build across packages; husky + commitlint + dependency-cruiser gate every commit/push.
- The source-only contracts package needs per-consumer wiring (Next `transpilePackages`, api tsconfig alias + Jest `moduleNameMapper`) — documented in the package guides.
- Choosing "embedded now" trades a small amount of future extraction work for much simpler operations during the MVP. The port boundary keeps that trade-off cheap.

See the root [`CLAUDE.md`](../../CLAUDE.md) for the binding rules these decisions produce.
