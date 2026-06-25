# ADR-0007 — Per-network wallet model, asset updates, and the backfill provisioning triad

**Status:** Accepted  
**Date:** 2026-06-25  
**Updated:** 2026-06-25 (BQ-2 — async BullMQ backfill)  
**Context:** WN-5 (wallet network backfill); BQ-2 (async BullMQ pattern); references WN-1, WN-3, ADR-0006.

---

## Context and problem

Blockradar (our WaaS, ADR-0006) provisions **one child address per network per user** — not per asset. All ERC-20 tokens on Ethereum resolve to the same ETH address; all TRC-20 tokens on TRON resolve to the same TRON address.

Two distinct operator actions require different backend responses:

1. **New asset on an existing network** (e.g. USDC on TRON): users already have the network wallet — just enable the Blockradar token on the master wallet dashboard. No per-user provisioning, no migration.
2. **New network** (e.g. ETH after TRON was live): existing users need a child address provisioned on the new network. A backfill is required.

Before WN-5, the system had eager provisioning at KYC completion (WN-3) and lazy provisioning in transactional flows, but no mechanism to backfill users who completed KYC before a new network was enabled.

---

## Decision

### 1. One wallet per (user, network) — not per asset

`Wallet` rows are keyed on `(userId, network)`, unique. `WalletBalance` rows track per-asset balances within that wallet. Adding a new asset on a network the user already has = zero DB migration, zero re-provisioning.

### 2. The three-phase provisioning triad

| Phase              | Trigger                                     | Mechanism                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Eager**          | KYC completion                              | `KycController` calls `WalletService.provisionAllEnabledNetworks(userId)` best-effort immediately after KYC. Covers newly verified users on all networks enabled at that moment.                                  |
| **Lazy**           | First transaction (buy, receive, send)      | `WalletService.getOrProvisionNetworkWallet(userId, network)` in each flow — idempotent get-or-create. Covers any user who was KYC'd before a network was enabled, on their first use of that network.             |
| **Backfill (ops)** | New network enabled; operator runs backfill | `WalletBackfillService.backfillMissingNetworkAddresses` pages all active users and calls `provisionAllEnabledNetworks` (idempotent). Covers all existing users in bulk before the new network goes live in flows. |

The triad is redundant by design: any missed provisioning (e.g. Blockradar outage during KYC) is caught by lazy provisioning or the backfill.

### 3. Async BullMQ execution (BQ-2)

The backfill is now **fully asynchronous**: the operator fires a single HTTP request and the work runs off the critical path. A durable `BackfillRun` row tracks progress; the admin UI polls it.

**Coordinator → fan-out pattern:**

```
POST /admin/wallets/backfill-networks
  → creates BackfillRun (queued)
  → enqueues 1 `coordinate` job on `wallet-backfill` BullMQ queue
  → returns { runId } 202

[coordinator job] pages active users, enqueues 1 `provision-user` job per user
  jobId = `${runId}__${userId}` (deterministic BullMQ deduplication, no `:`)
  marks BackfillRun running + totalUsers count

[provision-user jobs] (up to 10 concurrent, rate-limited)
  provision wallets, increment counters via SELECT FOR UPDATE
  last job to complete marks BackfillRun completed

GET /admin/wallets/backfill-runs/:id → BackfillRunStatusDto
```

**BackfillRun durable state:**

`BackfillRun` (`backfill_runs` table) records status, totalUsers, scannedUsers, perNetwork tallies (JSONB), and failures (JSONB array). Concurrent counter updates use a `SELECT ... FOR UPDATE` row lock inside a Prisma transaction — a single hot row cannot use optimistic concurrency (SERIALIZABLE SSI exhausts retries under 10+ concurrent writers).

**Dual entrypoints share the same domain logic:**

- **Admin HTTP endpoint** (`POST /admin/wallets/backfill-networks`): returns `{runId}` 202; poll via `GET /admin/wallets/backfill-runs/:id`.
- **CLI** (`api/src/cli/backfill-wallet-networks.ts`): enqueues the coordinator, then polls `BackfillRun` via the repository until `completed`/`failed`, and prints the final report.

**Module split (AppModule vs WorkerModule):**

BullMQ producers (controllers that enqueue) live in `AppModule`. Processors (`CoordinateBackfillProcessor`, `ProvisionUserProcessor`) live in `WorkerModule` (the separate worker entrypoint). `AdminModule` registers the `wallet-backfill` queue (via `BullModule.registerQueue`) so `@InjectQueue` resolves in `AdminWalletsController`.

**Bull Board:** both `echo` and `wallet-backfill` queues appear in `/admin/queues`.

### 4. Avoiding the wallets→identity cycle

`WalletBackfillService` needs to page active user IDs. Importing from `identity/application` directly would create a `wallets→identity→wallets` cycle (IdentityModule already imports WalletsModule for KYC controller provisioning).

Resolution: a new `IUserLister` port is owned by `wallets/application`. `ActiveUserListerPrismaAdapter` (identity/infrastructure) implements it. `IdentityModule` binds and exports the `USER_LISTER` token. `AdminModule` imports both `WalletsModule` and `IdentityModule` as the composition root — the binding is resolved at the module-composition layer, not inside any application service.

`dependency-cruiser` permits this: the forbidden rule is `application→infrastructure`, not `module→module` imports at the composition layer.

### 5. Fail-closed admin guard

`AdminTokenGuard` uses `timingSafeEqual` over SHA-256 digests (timing-oracle-safe). When `ADMIN_API_TOKEN` is unset (the default), every admin request is denied with 403. The endpoint ships disabled and unexploitable.

**Admin UI swap seam:** when the admin UI + proper admin-session auth is built, replace `AdminTokenGuard` with a session/role guard on `AdminWalletsController` (and in `AdminModule` providers). The controller, DTO, and `WalletBackfillService` are unchanged. `ADMIN_API_TOKEN` can then be removed from env.schema.

---

## Consequences

**Positive:**

- New asset on existing network = zero code change, zero migration, zero backfill.
- New network = config entry + master wallet + one backfill run (CLI or admin endpoint).
- Backfill is idempotent, cursor-safe for large user tables, and fault-tolerant (per-user error isolation via BullMQ retries; failures recorded in `BackfillRun.failures`).
- The backfill runs fully off the HTTP critical path: the operator fires one request and goes away; `BackfillRun` status is polled separately.
- Re-enqueueing the coordinator with the same `runId` is safe: deterministic `jobId` (`${runId}__${userId}`) causes BullMQ to skip duplicates.
- The shared `BackfillRunStatusSchema` contract is immediately consumable by the web admin UI.
- Bull Board (`/admin/queues`) gives live visibility into both queues.

**Negative / tradeoffs:**

- Lazy provisioning adds a Blockradar call on the first transaction to a new network — negligible latency for a rare first-time event.
- The `IUserLister` port is a small cross-module abstraction; justified by the cycle it prevents.
- `AdminTokenGuard` is a simpler credential model than session auth — acceptable for an ops-only endpoint with no user-facing UI yet.
- `SELECT FOR UPDATE` on the BackfillRun row serializes counter updates; throughput is bounded by Postgres lock speed (fast enough for job-completion frequency, which is much slower than raw DB throughput).
- Requires Redis (BullMQ). The ioredis connection is configured with `lazyConnect: true` + bounded retry so that e2e tests without Redis don't fail — only queued work is affected.

---

## References

- [ADR-0006 — Provider selections](0006-provider-selections.md) (Blockradar as WaaS)
- [docs/runbooks/adding-assets-and-networks.md](../runbooks/adding-assets-and-networks.md) — operator runbook
- WN-1: wallet-per-network model (Wallet ← not per-asset)
- WN-3: eager KYC provisioning
- WN-5: this ADR — backfill + admin endpoint
- BQ-1: BullMQ + Bull Board baseline
- BQ-2: async BullMQ backfill with BackfillRun durable state
