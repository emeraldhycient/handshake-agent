# ADR-0007 — Per-network wallet model, asset updates, and the backfill provisioning triad

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** WN-5 (wallet network backfill); references WN-1, WN-3, ADR-0006.

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

### 3. Reusable service + shared contracts + dual entrypoints

`WalletBackfillService` is presentation-agnostic: it takes a `BackfillNetworksRequest` (shared contract) and returns a `BackfillReport` (shared contract). Two thin entrypoints share the same service:

- **CLI now** (`api/src/cli/backfill-wallet-networks.ts`): boots NestJS application context (no HTTP server), reads `DRY_RUN`/`BATCH_SIZE` from env, prints the report, exits with code 0/1/2.
- **Admin HTTP endpoint now** (`POST /admin/wallets/backfill-networks`): fail-closed `AdminTokenGuard` (Bearer token; UNSET → 403 always). The web admin UI hooks up to this endpoint with zero rework when it lands.

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
- Backfill is idempotent, cursor-safe for large user tables, and fault-tolerant (per-user error isolation).
- The shared `BackfillReport` contract is immediately consumable by the web admin UI (same Zod schema for form + API response validation).
- The admin endpoint is present and wired before the UI — the UI team has a stable API to build against.

**Negative / tradeoffs:**

- Lazy provisioning adds a Blockradar call on the first transaction to a new network — negligible latency for a rare first-time event.
- The `IUserLister` port is a small cross-module abstraction; justified by the cycle it prevents.
- `AdminTokenGuard` is a simpler credential model than session auth — acceptable for an ops-only endpoint with no user-facing UI yet.

---

## References

- [ADR-0006 — Provider selections](0006-provider-selections.md) (Blockradar as WaaS)
- [docs/runbooks/adding-assets-and-networks.md](../runbooks/adding-assets-and-networks.md) — operator runbook
- WN-1: wallet-per-network model (Wallet ← not per-asset)
- WN-3: eager KYC provisioning
- WN-5: this ADR — backfill + admin endpoint
