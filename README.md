# Handshake Agent

Chat-native crypto, payments, and ticketing for the Nigerian market. WhatsApp is the acquisition/discovery/support channel; the web app is the system of record where verification and every money-moving transaction happen.

The core safety property: **no language-model output moves money on its own.** The model interprets intent into a validated structured object; a separate deterministic engine executes — after explicit confirmation, server-side validation, and PIN + step-up. See [`docs/PRD.md`](docs/PRD.md) §4.

## Monorepo layout

```
handshake-agent/
├── api/                 # NestJS 11 backend (Prisma + Postgres, LangGraph agent, deterministic engine)
├── web/                 # Next.js 16 frontend (TanStack Query, Zustand, Axios, Zod + RHF, Tailwind v4 + shadcn)
├── packages/contracts/  # shared Zod schemas + inferred types (single source of truth across FE/BE/agent)
└── docs/                # BRD, PRD, Investor memo, ADRs
```

## Getting started

```bash
corepack use pnpm@10.25.0
pnpm install
```

Then follow the one-time activation in [`CLAUDE.md`](CLAUDE.md) §11 to install per-package libraries and wire the shared contracts package.

## How the workspace fits together

This is a **pnpm workspace**: one repo, several packages, each with its own `package.json`. You install once at the root — you do not `cd` into each folder.

- `pnpm install` (root) installs and links **every** package and writes one `pnpm-lock.yaml`.
- Add a dependency to one package by name: `pnpm --filter @handshake-agent/api add <dep>` (or `pnpm add -Dw <devtool>` for a shared root tool).
- `packages/contracts` is a **source-only shared library** (Zod schemas = one source of truth for FE/BE/agent). Apps link it with `pnpm --filter <app> add '@handshake-agent/contracts@workspace:*'`, which symlinks it — no build, no npm publish.

Full explanation (the dependency model, the `workspace:*` protocol, per-consumer wiring, and a worked example) is in **[`docs/monorepo.md`](docs/monorepo.md)**.

## Common commands

```bash
pnpm build | lint | typecheck | test | format | depcruise   # turbo, fans out to all workspaces
pnpm --filter @handshake-agent/web dev                       # Next dev server
pnpm --filter @handshake-agent/api start:dev                 # Nest watch mode
```

## Working in this repo

Read [`CLAUDE.md`](CLAUDE.md) (the constitution) and the relevant package `CLAUDE.md` before making changes. Strict TDD, Conventional Commits, and the clean-architecture import boundaries (enforced by `dependency-cruiser`) are required.
