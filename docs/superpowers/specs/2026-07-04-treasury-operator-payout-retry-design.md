# Treasury operator payout-retry — design spec

**Date:** 2026-07-04
**Branch / PR:** `feat/treasury-operator-writes` → pushed to `feat/platform-hardening` (PR #26, "Go-readiness")
**Task:** Go-readiness #2 — treasury operator WRITE controls, first slice: manual retry of a **stuck sell payout**.
**Status:** Draft for user review.

---

## 1. Context & findings (why this spec differs from the task brief)

The task brief was written against an earlier snapshot. Verified ground truth on the base branch (`feat/platform-hardening` = `origin/main` + 28 go-readiness commits, carries the full admin dashboard infra):

1. **Treasury WRITE surface already exists.** The brief says "there is NO operator write surface." Not true here. `origin/main` already ships:
   - `AdminTxnTriageService.retrySettlement(txnId, adminId)` — re-arms the **existing** `processor_payout` outbox row to `pending` (`outbox.resetToPending`), which re-drives settlement through the engine's `settleSellPayout` via the reconciliation worker. **Reuses the original outbox row / idempotency key** (provider dedupes — no new key). **Audited.**
   - Exposed via `POST /admin/transactions/:id/retry` ([admin-txn-triage.controller.ts:56](../../../api/src/modules/admin/presentation/admin-txn-triage.controller.ts)) and via the four-eyes `payout_release` change request ([admin-approvals.service.ts:255](../../../api/src/modules/admin/application/admin-approvals.service.ts)).
   - `POST /admin/treasury/payouts/:id/approve` raises a `payout_release` change request from the read-only payout queue.

   ⇒ Mandate points **(1) engine kernel**, **(3) reuse original key**, **(5) step-up + permission**, and **audit** are *already satisfied* by existing code. This slice must **not duplicate** them (§13.1).

2. **Two genuine gaps** in the existing retry (this slice closes them):
   - **Gap A — no status gate.** `retrySettlement` re-enqueues for *any* status. Double-pay is only prevented downstream by `settleSellPayout`'s own idempotency; there is no explicit up-front reject of a `completed` tx, and re-arming a terminal `failed` tx makes `settleSellPayout` throw `SettlementInvalidStatusError('failed')` on every 2-minute tick forever (a footgun).
   - **Gap B — no KYC/velocity/sanctions re-check (§3.3).** Neither `retrySettlement` nor `settleSellPayout` re-screens the user at retry.

3. **Semantic inversion (signed off by user → Option A).** The engine **auto-refunds** a failed sell payout: on a definitive Flutterwave 4xx reject *and* on `verifyPayout='failed'`, `executeSell`/`settleSellPayout` call `settleSellRefundAtomic` (reserve returned to the user, tx marked `failed`). So a **terminal-`failed` sell has already been made whole — there is no held reserve to re-pay.** The only sell whose payout can be meaningfully retried is a **stuck `settling`** one. The brief's literal wording ("retry FAILED, reject settling") is therefore inverted; **user signed off on Option A: retry a stuck `settling` sell payout.**

### File-map deviations (from the brief), with justification

| Brief file | This spec | Why |
|---|---|---|
| `treasury/application/treasury-operator.service.ts` | `admin/application/admin-treasury-payout-retry.service.ts` | On this branch the treasury *oversight* services live in the **admin** module; the `treasury` module holds only the payment provider + read repo. Follow the actual structure. |
| `treasury/presentation/admin-treasury.controller.ts` + dto | **extend** existing `admin/presentation/admin-treasury.controller.ts` + new dto | The controller already exists in the admin module and already carries `AdminSessionGuard`+`PermissionGuard`. Extend it (§13.1), don't fork. |
| `treasury-audit-log.repository.port.ts` + infra impl | **reuse** the global `AuditService` (`core/audit`) | An immutable, hash-chained audit log already exists and is the canonical audit primitive (§13.1). A treasury-specific audit port would duplicate it. |
| `contracts/admin/treasury.schemas.ts` | reuse existing `contracts` treasury schemas file; add request/response there | Matches the brief in spirit. |

---

> **Update 2026-07-04 (follow-up):** generalized from sell-only to **sell + on-chain send** payouts (both are the non-terminal types in the payout queue). The re-check reads the uniform `velocityFiatAmount`/`velocityFiatCurrency` metadata (present on both), and a **send additionally re-screens the destination address** via `ComplianceService.screenSendDestination`. Method renamed `retrySellPayout` → `retryPayout`; type is resolved server-side and dispatched to the matching outbox type (`processor_payout` / `onchain_send`). Swap is not a beneficiary payout (not in the payout queue) and float/reserve sweep remain out of scope.

## 2. Chosen semantics (Option A — retry a stuck settling sell/send payout)

**Operator intent:** "This sell's bank payout is stuck (missed webhook / provider pending / outbox wedged in a non-`pending` status the autonomous reconciler can't pick up). Re-drive it now, after re-confirming the user is still allowed."

**Guarantees:**
- Goes through the deterministic engine kernel — re-arms the **existing** `SettlementOutbox` row (the `SettlementOutbox settle path`), never constructs a ledger entry, never imports `ExecutionService` into the admin layer (stays consistent with `retrySettlement`).
- **Reuses the original idempotency key** (the same outbox row / `reference`). The engine's `settleSellPayout(reference)` calls `verifyPayout(reference)` and finalizes-if-actually-paid or refunds-if-actually-failed. **No new outbound payment is ever initiated by a retry** ⇒ there is *no* double-pay surface in this path.
- Hard status gate + a server-side KYC/status/sanctions re-check *before* re-arming.
- Immutable audit of `{ operatorId, txId, reason, result }`.

---

## 3. Flow (`AdminTreasuryPayoutRetryService.retrySellPayout`)

Input: `payoutId` (the opaque payout-queue item id — server resolves the real `transactionId`; a client can never point the retry at a different txn), `reason`, `adminId`.

1. **Resolve server-side.** `treasury.findPayoutQueueItem(payoutId)` → `{ transactionId, method, ... }`. `null` → `AdminNotFoundError` (404). The payout queue only lists non-terminal outbox rows (`pending|enqueued|in_progress`), so a completed/failed payout is already absent — but we still re-load and re-gate the transaction (defence in depth).
2. **Load the transaction.** `transactions.findById(transactionId)`. `null` → 404.
3. **Hard status gate (Gap A).**
   - `txn.type !== 'sell'` → `TxnNotTriageableError` (422). *(Send/swap payout retry is a later slice.)*
   - `txn.status === 'completed'` → **reject 409** (already paid — never re-touch; prevents any double-pay).
   - `txn.status === 'failed'` → **reject 409** (already refunded; the user must re-initiate — nothing to re-pay).
   - `txn.status !== 'settling'` (e.g. `pending`/`rolled_back`) → reject 409.
   - Require a `processor_payout` outbox row via `outbox.findByTransactionId` → else `TxnNotTriageableError` (422, "no payout settlement to retry").
4. **Re-check the user server-side (Gap B, §3.3).** A **payout-release-safe** gate that re-runs:
   - SIM-swap block, KYC `status === 'verified'`, tier not `unverified`, tier-change cooling-off, **per-tx** cap for this sell's fiat amount — *(all from the existing `KycGateService` logic)*;
   - **compliance standing**: no open blocking `ComplianceEvent` for the user (via the existing `IComplianceEventRepository`);
   - **but NOT** the cumulative **daily-velocity** counter — this tx already consumed its velocity allocation at `executeSell` reserve time (`velocityIncrement`), so re-running `assertCanTransact` wholesale would **double-count** and falsely throw `VelocityExceededError`. → **Decision (locked):** add a dedicated `KycGateService.assertCanReleasePayout(userId, fiatAmount, fiatCurrency, asset)` that re-runs SIM-swap / KYC-status / tier / tier-change-cooling-off / per-tx cap + compliance standing, and **omits the daily-amount/count velocity step**. Keeps the money-gate logic canonical in `KycGateService`.
   - On re-check **failure** (**Decision (locked): reject + escalate**): do **NOT** re-arm. Reject with the typed gate error (mapped to 403) **and** open a compliance escalation (`ComplianceEvent`, `flagged`) + audit, so a since-flagged/downgraded user's stuck payout is never pushed through by the operator and is surfaced for manual handling. We never auto-move money here (the payout may already be in flight — refunding a paid-out sell would double-credit).
5. **Re-drive via the engine (reuse original key).** `outbox.resetToPending(row.id)` — re-arms the existing row for the reconciliation worker, which calls `settleSellPayout(reference)` with the original `reference`. (This is exactly `retrySettlement`'s mechanism; we call the outbox port directly here because we must run steps 3–4 first and audit a treasury-specific action.)
6. **Audit.** `AuditService.record({ actorAdminId: adminId, subject: 'Transaction:<id>', action: 'admin_override', before: { status, outboxStatus }, after: { action: 'payout_retry_enqueued', reason } })`.
7. **Return** `{ payoutId, transactionId, status: 'retry_enqueued', reChecked: true }`.

### On the autonomous reconciler (corrected 2026-07-04)
An earlier draft flagged "the reconciler finalizes flagged users' payouts without the re-check" as a limitation. On closer inspection that is **not a funds-safety hole**: every reconciler settle path (`settleSellPayout`, `settleSendOnChain`, `settleSwap`, `settleBuyPayment`) is **verify-only** — it calls the provider's *verify* endpoint and books the already-determined outcome (finalize the ledger, or refund); **none ever initiate a new outbound payment** (no `createPayout`/`withdraw`). A KYC/sanctions re-check can only prevent money movement at `executeSell`/`executeSend` (before the provider call); at retry/settle the payment has already happened or not. So making the reconciler "consult the gate and block" would be **harmful** — it would strand the clearing balance for a payout the provider already sent, with nothing to recover.

The re-check therefore belongs where it is: the **operator surface**. Its value is (a) it stops an operator from actively re-driving a flagged user's payout and (b) it **escalates** the flag (a compliance case) for human review. The autonomous reconciler correctly books provider-verified outcomes regardless of current flag state; a genuinely-sanctioned user is handled by account freeze + SAR, not by holding an already-sent payout's ledger entry.

---

## 4. Endpoint & authorization

`POST /admin/treasury/payouts/:id/retry` on the existing `AdminTreasuryController`:
- `@UseGuards(AdminSessionGuard, PermissionGuard, AdminStepUpGuard)` (step-up like the sibling write endpoints).
- `@RequirePermission('api_route', 'POST /admin/treasury/payouts/:id/retry', 'execute')`.
- Body dto `TreasuryPayoutRetryDto { reason: string (min length) }`.
- Response parsed through a contract schema before leaving the boundary.

**Approval model (locked): single-admin step-up + permission + audit** — matches the task mandate wording ("@AdminStepUp + RequirePermission on the endpoint") and the existing `POST /admin/transactions/:id/retry`. Justified because Option A's re-drive is **verify-only** (no new outbound send ⇒ no double-pay surface). *(Rejected alternative: four-eyes `AdminApprovalsService` `payout_retry` kind — heavier, unnecessary given the verify-only surface.)*

---

## 5. Safety-invariant mapping (§3)

| Invariant | How preserved |
|---|---|
| §3.1 model-proposes/engine-disposes | Admin layer never builds a ledger entry; it re-arms the outbox → engine's atomic `settleSellPayout`. No `ExecutionService` import in admin. |
| §3.2 agent/DB isolation | Service holds no Prisma import; reaches data via `TREASURY_READ_REPOSITORY`, `TRANSACTION_REPOSITORY`, `SETTLEMENT_OUTBOX_REPOSITORY`, `COMPLIANCE_EVENT_REPOSITORY` ports + `AuditService`. |
| §3.3 server-side KYC/limit/sanctions | Step 4 re-check runs server-side at retry; `transactionId` derived server-side (never client). |
| §3.6 no shortcuts / audit | Immutable audit on every attempt; fails closed on unknown/ineligible payout. |
| No double-pay | Reuses original idempotency key; hard-rejects `completed`; re-drive is verify-only (never a fresh `createPayout`). |

---

## 6. TDD test plan (write tests first)

**Unit — `admin-treasury-payout-retry.service.spec.ts`:**
1. Happy path: stuck `settling` sell + passing re-check → `outbox.resetToPending` called with the row id, audit recorded, returns `retry_enqueued`.
2. Reject already-succeeded: `completed` sell → 409, **no** `resetToPending`, **no** engine call (no double-pay).
3. Reject already-refunded terminal: `failed` sell → 409, no re-arm.
4. Reject non-sell: `send`/`swap`/`buy` → 422.
5. Reject missing outbox row → 422.
6. Idempotency re-entrancy: two retries of the same stuck sell both re-arm the same row (same `reference`); never mint a new key; safe under repeat.
7. KYC-downgrade / SIM-swap / not-verified blocks retry → 403, **no** re-arm, compliance escalation opened + audited.
8. Velocity double-count guard: a user at/over their daily cap whose *only* usage is this in-flight sell is **not** falsely blocked (the re-check omits the cumulative daily counter).
9. Unknown payout id → 404.

**Integration / e2e — audit immutability & endpoint:**
10. `admin-treasury-payout-retry.e2e-spec.ts` (Testcontainers Postgres): retry writes an append-only, hash-chained `AuditLog` row that cannot be mutated/deleted; endpoint enforces `PermissionGuard` (403 without perm) and `AdminStepUpGuard` (step-up required); response matches the contract schema.

**Contracts:** parse valid/invalid `TreasuryPayoutRetryDto` / response fixtures.

Coverage target: ~100% on the new service (money-path, §9).

---

## 7. Resolved decisions (2026-07-04, user sign-off)

1. **Approval model:** ✅ single-admin **step-up + permission + audit** (verify-only surface → no double-pay). Four-eyes rejected as unnecessary.
2. **Velocity re-check shape:** ✅ dedicated **`KycGateService.assertCanReleasePayout`** that omits the cumulative daily-velocity step (avoids double-count of this tx's already-consumed allocation).
3. **Re-check-failure behavior:** ✅ **reject (403) + open compliance escalation + audit**; never auto-move money.

## 8. Out of scope (explicitly deferred)

- ~~Send payout retry~~ — **done** in the 2026-07-04 follow-up (see the §2 update).
- **Swap** re-drive — a swap is not a beneficiary "payout" and is not surfaced by the payout queue; it needs a separate lookup + concept.
- Float / reserve sweep / rebalance (must never move *customer* funds — only platform float; the original task explicitly deferred it).
- ~~Making the autonomous reconciler consult the retry gate~~ — **withdrawn**: the reconciler is verify-only and never initiates a payment, so this would strand funds, not add safety (see the corrected note in §3).
- Any new outbound-send retry semantics (Option B) — not chosen.
