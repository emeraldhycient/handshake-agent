# Runbook: Adding assets and networks

**Audience:** Ops / engineering. Read before making catalog changes in production.

---

## Scenario A — Adding a new asset on an **existing** network

Example: adding a new stablecoin (e.g. USDC) on TRON, where TRON is already enabled.

**No per-user wallet backfill is needed.** All active users already have a TRON child address provisioned (at KYC completion via `provisionAllEnabledNetworks`). Blockradar child addresses receive **all** assets on their chain — there is no per-asset address.

Steps:

1. Add the new `CatalogAsset` entry (with `enabled: true`) to `api/config/defaults/catalog.json` (or the DB-admin layer).
2. Enable the new token on the **master wallet** in the Blockradar dashboard (or via the Blockradar API): "Add token → select the asset → enable deposits and withdrawals".
3. Deploy the config change. The new asset is immediately available to all users who already have a network wallet.
4. No migration, no backfill, no re-provisioning.

---

## Scenario B — Enabling a **new network**

Example: enabling ETH (ERC-20) after TRON was already live.

Existing users only have TRON wallets. A backfill is required to provision their ETH child addresses.

### Steps

1. **Create the Blockradar master wallet** for the new network in the Blockradar dashboard.
2. **Set the master wallet env var** (`BLOCKRADAR_MASTER_WALLET_<NETWORK>=<id>`) in your deployment config. E.g. `BLOCKRADAR_MASTER_WALLET_ETH=<eth-master-wallet-id>`.
3. **Add the `CatalogNetwork` entry** (with `enabled: true`) to `api/config/defaults/catalog.json`. New asset–network pairings go in the asset's `networks` array.
4. **Deploy** the updated config.
5. **Dry-run the backfill** to audit scope before committing:

   ```bash
   DRY_RUN=true pnpm --filter @handshake-agent/api backfill:wallet-networks
   ```

   Review the report:
   - `usersScanned`: total active users processed.
   - `perNetwork.ETH.provisioned`: users who would receive a new ETH wallet.
   - `perNetwork.TRON.alreadyHad`: users who already have a TRON wallet (no change).
   - `failures`: any users that failed (investigate before live run).

6. **Live run** (once dry-run confirms expected counts, zero unexpected failures):

   ```bash
   pnpm --filter @handshake-agent/api backfill:wallet-networks
   ```

   Or, if `ADMIN_API_TOKEN` is configured, via the admin endpoint:

   ```http
   POST /admin/wallets/backfill-networks
   Authorization: Bearer <ADMIN_API_TOKEN>
   Content-Type: application/json

   { "batchSize": 100, "dryRun": false }
   ```

7. **Verify** the report output:
   - `failures` should be empty (or investigate any failures individually).
   - `perNetwork.ETH.provisioned` should match `perNetwork.ETH.provisioned` from the dry-run.
   - Re-run if any failures occurred (the operation is idempotent — already-provisioned users are skipped).

8. **New users going forward** receive ETH wallets automatically at KYC completion via `provisionAllEnabledNetworks` — no further backfill is needed for them.

---

## Tuning

| Variable     | Default | Description                                               |
| ------------ | ------- | --------------------------------------------------------- |
| `DRY_RUN`    | `false` | `true` = report only, no wallets created.                 |
| `BATCH_SIZE` | `100`   | Users per DB page. Lower for less provider call pressure. |

---

## Notes

- The backfill is **idempotent**: re-running after a partial failure is always safe.
- The backfill scans **active users only** (`status = 'active'`). Suspended / pending users are skipped.
- Provider (Blockradar) calls are capped by concurrency inside `WalletService.provisionAllEnabledNetworks`. Per-user failures are logged and tallied but never abort the batch.
- The CLI exits with code `0` on success, `1` on partial failures, `2` on fatal startup errors.
