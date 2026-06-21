# Implementation plan

The full, ordered ticket backlog for building Handshake Agent end to end lives in [`backlog.md`](backlog.md). This file is the operating manual for it.

> Read first: [`../CLAUDE.md`](../CLAUDE.md) (the constitution), [`../docs/PRD.md`](../docs/PRD.md), [`../docs/BRD.md`](../docs/BRD.md), and the ADRs in [`../docs/adr/`](../docs/adr/).

## How to read a ticket

```
- **FND-01 — Activate the pnpm workspace** · S · deps: —
  One-line description of the change.
  AC: acceptance criterion; another; another.
```

- **ID** — `PREFIX-NN`. Prefix = domain (see legend). Numbers are stable; never renumber.
- **Size** — S (≤1 day), M (1–3 days), L (3–5 days; if bigger, split it).
- **deps** — ticket ids that must land first. `—` means none beyond its phase predecessors.
- **AC** — acceptance criteria; the ticket is done only when all hold and the DoD below is met.

## Definition of done (applies to EVERY ticket)

These are not restated per ticket — they are always required (they mirror [`../CLAUDE.md`](../CLAUDE.md) §3, §5, §9, §13):

1. **TDD** — failing test first; ~100% coverage on domain/application/the execution engine. Integration tests use real Postgres via Testcontainers.
2. **Clean architecture** — `presentation → application → domain`; `infrastructure` implements ports; `application` never imports `infrastructure`/`@prisma/client`; the agent never touches the DB. `pnpm depcruise` passes.
3. **Contracts-first** — any shape crossing FE/BE/agent is a Zod schema in `packages/contracts` (never redefined). Request DTOs via `nestjs-zod`.
4. **Server-side gating** — every money-moving endpoint re-checks KYC status + tier limit + velocity + sanctions server-side. The FE gate is UX only.
5. **Auditability** — every proposal/confirmation/authorization/execution **and every admin action** writes an immutable, hash-chained audit record (actor, correlation id, before/after, reason). Nothing money- or config-touching is un-audited.
6. **Idempotency** — all side-effecting operations carry an idempotency key; at-most-once execution.
7. **Config discipline** — secrets → env (Zod-validated at boot); business-tunable values → DB-admin layered config; static defaults → JSON. Nothing tunable is hardcoded.
8. **Security** — secrets never logged; PII redacted in logs; the model never moves money; model free-text is never a financial parameter.
9. **Gates green** — `pnpm lint && pnpm typecheck && pnpm test && pnpm depcruise`; Conventional Commit; one coherent change per commit.

## Domain prefixes

| Prefix | Domain                                                                                   |
| ------ | ---------------------------------------------------------------------------------------- |
| `FND`  | Foundation & DevOps (config, registry, CI, observability)                                |
| `AUD`  | Audit, compliance & trackability (hash-chained log, sanctions, AML, Travel Rule)         |
| `IDN`  | Identity, KYC, devices, PIN/step-up (regular users)                                      |
| `ADM`  | Admin platform & RBAC (separate admin users, roles, route/page permissions, invitations) |
| `WAL`  | Wallets & custody (WaaS)                                                                 |
| `QTE`  | Pricing, quotes & treasury                                                               |
| `TXN`  | Deterministic execution engine (buy/sell/send/swap)                                      |
| `RCP`  | Transaction receipts                                                                     |
| `NTF`  | Notification system                                                                      |
| `TKT`  | Event ticketing                                                                          |
| `AGT`  | Agent / NLU (LangGraph + Claude)                                                         |
| `CHN`  | Channels (WhatsApp + web + conversations)                                                |
| `WEB`  | Frontend web app + admin console UI                                                      |
| `OPS`  | Hardening, security, launch                                                              |

## Phase map (dependency order)

| Phase | Theme                          | Domains               |
| ----- | ------------------------------ | --------------------- |
| 0     | Foundation & audit spine       | FND, AUD (core)       |
| 1     | Identity, auth, admin & RBAC   | IDN, ADM, KYC         |
| 2     | Wallets, pricing & treasury    | WAL, QTE              |
| 3     | Execution engine & receipts    | TXN, RCP              |
| 4     | Notifications & compliance ops | NTF, AUD (compliance) |
| 5     | Agent & channels               | AGT, CHN              |
| 6     | Event ticketing                | TKT                   |
| 7     | Frontend web + admin console   | WEB                   |
| 8     | Hardening & launch             | OPS                   |

Phases are sequenced by dependency, not calendar — independent epics within/across phases run in parallel. Frontend (Phase 7) tickets each depend on their backend epic and can start the moment that API lands; they are grouped for readability, not deferred.

## Status tracking

Track status inline in `backlog.md` by prefixing a ticket with a state tag: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked. Keep one PR per ticket where practical; reference the ticket id in the commit/PR title (`feat(api): TXN-04 …`).
