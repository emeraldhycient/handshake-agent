# Treasury Operator Payout-Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a treasury-operator action that safely re-drives a **stuck `settling` sell payout** through the engine, after a server-side KYC/status/compliance re-check — closing the two gaps (no status gate, no §3.3 re-check) in the existing `retrySettlement`.

**Architecture:** New `AdminTreasuryPayoutRetryService` (admin/application) resolves the payout server-side, hard-gates it (`type=sell` + `status=settling` + has a `processor_payout` outbox row; rejects `completed`/`failed`/others as 409), re-checks the user via a new velocity-free `KycGateService.assertCanReleasePayout` + a compliance-standing check (403 + escalation on failure), then re-arms the **existing** outbox row (`resetToPending` — reuses the original idempotency key; the engine's reconciler settles) and writes an immutable audit. Exposed as `POST /admin/treasury/payouts/:id/retry` (single-admin step-up + permission).

**Tech Stack:** NestJS 11, TypeScript, Jest + `@nestjs/testing`, Testcontainers (e2e), Zod contracts (`nestjs-zod`), Prisma 7.

## Global Constraints

- §3.1 the model proposes / the engine disposes — the admin layer NEVER builds a ledger entry; re-drive only via `outbox.resetToPending`; NEVER import `ExecutionService` into the admin module.
- §3.2 no Prisma import in application/domain; reach data via injected ports only.
- §3.3 server-side KYC/limit/sanctions re-check on the money path; the `transactionId` is always derived server-side, never from the client.
- §3.6 no shortcuts, no placeholders; every attempt is immutably audited; fail closed on unknown/ineligible payout.
- No double-pay: reuse the original idempotency key (same outbox row); hard-reject `completed`; the re-drive is verify-only (the engine's `settleSellPayout` calls `verifyPayout`, never a fresh `createPayout`).
- TDD: Red → Green → Refactor; ~100% coverage on the new service (money path, §9). Backend unit config is the inline `jest` block in `api/package.json`; e2e is `api/test/jest-e2e.json`.
- Conventional Commits (`feat(api): …`, `test(api): …`). Commit after each green step. Pre-commit hook needs `pnpm install` in this worktree first (Task 0); if `lint-staged` is still unavailable, commit with `--no-verify` and note it.
- Verify with the bare linter (`pnpm --filter @handshake-agent/api exec eslint <files>`), NOT `pnpm lint` (the api `lint` script runs `--fix` and mutates files).

---

### Task 0: Worktree bootstrap (fold into Task 1's first commit if trivial)

**Files:** none (environment only).

- [ ] **Step 1: Install deps in this worktree** — worktrees need their own install; the pre-commit hook (`lint-staged`) and jest need `node_modules`.

Run: `pnpm install`
Expected: completes; `node_modules/.bin/lint-staged` exists.

- [ ] **Step 2: Regenerate Prisma client** (branch carries the `widen_fiat_currency` migration).

Run: `pnpm --filter @handshake-agent/api exec prisma generate`
Expected: "Generated Prisma Client".

- [ ] **Step 3: Baseline the suites that this plan touches** so later diffs are attributable.

Run: `pnpm --filter @handshake-agent/api exec jest --silent kyc-gate` (note pass count)
Expected: existing kyc-gate specs PASS.

---

### Task 1: Contract — permission catalog entry + retry request/response schemas

**Files:**
- Modify: `packages/contracts/src/admin/permissions.ts` (add one `r(...)` entry in the Treasury block, ~line 758 after the `payouts/:id/approve` entry)
- Modify: `packages/contracts/src/admin/permissions.spec.ts` (assert the new id is present; bump any total-count assertion)
- Modify: `packages/contracts/src/admin/treasury-action.dto.ts` (exports `TreasuryPayoutApproveResponseSchema`) — add the two schemas + inferred types
- Test: `packages/contracts/src/admin/permissions.spec.ts` (above) + a round-trip in `packages/contracts/src/admin/treasury-action.dto.spec.ts`

**Interfaces:**
- Produces: catalog id `api_route:POST /admin/treasury/payouts/:id/retry:execute`; `TreasuryPayoutRetryRequestSchema` = `{ reason: string (min 3) }`; `TreasuryPayoutRetryResponseSchema` = `{ payoutId: string; transactionId: string; status: 'retry_enqueued'; reChecked: boolean }`; inferred types `TreasuryPayoutRetryRequest`, `TreasuryPayoutRetryResponse`.

- [ ] **Step 1: Write the failing permission-catalog test**

In `permissions.spec.ts`, next to the existing `payouts/:id/approve` assertions add:

```ts
it('includes the treasury payout-retry api_route permission', () => {
  const ids = new Set(PERMISSION_CATALOG.map((p) => p.id));
  expect(
    ids.has('api_route:POST /admin/treasury/payouts/:id/retry:execute'),
  ).toBe(true);
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @handshake-agent/contracts exec jest permissions -t "payout-retry"`
Expected: FAIL (id not in catalog).

- [ ] **Step 3: Add the catalog entry** in the Treasury block of `permissions.ts` (mirror the `payouts/:id/approve` entry exactly):

```ts
  r(
    'api_route',
    'POST /admin/treasury/payouts/:id/retry',
    'execute',
    'Treasury',
    'Retry a stuck settling sell payout via the engine (re-checks the user; re-drives the existing settlement)',
  ),
```

- [ ] **Step 4: Add the request/response schemas** to the contracts treasury-schemas file:

```ts
export const TreasuryPayoutRetryRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type TreasuryPayoutRetryRequest = z.infer<
  typeof TreasuryPayoutRetryRequestSchema
>;

export const TreasuryPayoutRetryResponseSchema = z.object({
  payoutId: z.string(),
  transactionId: z.string(),
  status: z.literal('retry_enqueued'),
  reChecked: z.boolean(),
});
export type TreasuryPayoutRetryResponse = z.infer<
  typeof TreasuryPayoutRetryResponseSchema
>;
```

- [ ] **Step 5: Run contract tests — verify green** (fix any total-count assertion in `permissions.spec.ts` by +1).

Run: `pnpm --filter @handshake-agent/contracts test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/admin/permissions.ts packages/contracts/src/admin/permissions.spec.ts packages/contracts/src/admin/treasury-action.dto.ts packages/contracts/src/admin/treasury-action.dto.spec.ts
git commit -m "feat(contracts): treasury payout-retry permission + request/response schemas"
```

---

### Task 2: Domain error `PayoutRetryBlockedError` (403) + filter mapping

**Files:**
- Modify: `api/src/modules/admin/domain/admin-errors.ts` (add `'ADMIN_PAYOUT_RETRY_BLOCKED'` to the `AdminErrorCode` union)
- Create: `api/src/modules/admin/domain/treasury-operator-errors.ts` (the error class)
- Modify: `api/src/core/common/domain-exception.filter.ts` (add the 403 map entry)
- Test: `api/src/core/common/domain-exception.filter.spec.ts`

**Interfaces:**
- Produces: `class PayoutRetryBlockedError extends AdminError { readonly code = 'ADMIN_PAYOUT_RETRY_BLOCKED' }`; filter maps `ADMIN_PAYOUT_RETRY_BLOCKED → 403`.

- [ ] **Step 1: Write the failing filter test** in `domain-exception.filter.spec.ts` (mirror an existing 403 case):

```ts
it('maps ADMIN_PAYOUT_RETRY_BLOCKED to 403', () => {
  const err = { code: 'ADMIN_PAYOUT_RETRY_BLOCKED' };
  filter.catch(err, host);
  expect(statusMock).toHaveBeenCalledWith(403);
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @handshake-agent/api exec jest domain-exception.filter -t "PAYOUT_RETRY_BLOCKED"`
Expected: FAIL (falls through to 500).

- [ ] **Step 3a: Add the code to the union** in `admin-errors.ts` (append to `AdminErrorCode`):

```ts
  | 'ADMIN_PAYOUT_RETRY_BLOCKED'
```

- [ ] **Step 3b: Create the error class** `treasury-operator-errors.ts`:

```ts
import { AdminError } from './admin-errors';

/**
 * A stuck sell payout cannot be retried because the owning user failed the
 * server-side re-check at retry time (SIM-swap / KYC-not-verified / tier
 * downgrade / cooling-off / per-tx cap / open compliance block). Maps to HTTP
 * 403 — the action is not permitted for this account. The retry service also
 * opens a compliance escalation before throwing this (§3.3).
 */
export class PayoutRetryBlockedError extends AdminError {
  readonly code = 'ADMIN_PAYOUT_RETRY_BLOCKED' as const;
  constructor(reason = 'This payout cannot be retried for this account.') {
    super(reason);
  }
}
```

- [ ] **Step 3c: Add the filter map entry** in `domain-exception.filter.ts` (Admin block, near `ADMIN_TXN_NOT_TRIAGEABLE`):

```ts
  ADMIN_PAYOUT_RETRY_BLOCKED: {
    status: HttpStatus.FORBIDDEN,
    message: 'This payout cannot be retried for this account.',
  },
```

- [ ] **Step 4: Run — verify green**

Run: `pnpm --filter @handshake-agent/api exec jest domain-exception.filter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/domain/admin-errors.ts api/src/modules/admin/domain/treasury-operator-errors.ts api/src/core/common/domain-exception.filter.ts api/src/core/common/domain-exception.filter.spec.ts
git commit -m "feat(api): PayoutRetryBlockedError → 403 domain mapping"
```

---

### Task 3: `KycGateService.assertCanReleasePayout` (velocity-free re-check)

**Files:**
- Modify: `api/src/modules/identity/application/kyc-gate.service.ts`
- Test: `api/src/modules/identity/application/kyc-gate.service.spec.ts`

**Interfaces:**
- Produces: `assertCanReleasePayout(input: { userId: string; fiatAmount: string; fiatCurrency: string; asset: string }): Promise<void>` — runs SIM-swap, KYC status/tier, tier-change cooling-off, positive-amount + per-tx cap; **omits** the daily/weekly velocity + on-chain-send caps (this tx already consumed its velocity at `executeSell`).
- Consumes: existing private state (`identityRepo`, `config`, `clock`) and gate errors from `../domain/gate-errors`.

- [ ] **Step 1: Write failing tests** in `kyc-gate.service.spec.ts`:

```ts
describe('assertCanReleasePayout', () => {
  it('passes for a verified user within the per-tx cap and does NOT touch velocity', async () => {
    // arrange a verified tier_2 user; spy on velocityRepo.getDailyUsage
    await expect(
      service.assertCanReleasePayout({
        userId, fiatAmount: '10000', fiatCurrency: 'NGN', asset: 'USDT',
      }),
    ).resolves.toBeUndefined();
    expect(velocityRepo.getDailyUsage).not.toHaveBeenCalled(); // velocity skipped
  });

  it('throws KycNotVerifiedError when kycStatus !== verified', async () => {
    // user with kycStatus 'pending'
    await expect(
      service.assertCanReleasePayout({ userId, fiatAmount: '10000', fiatCurrency: 'NGN', asset: 'USDT' }),
    ).rejects.toBeInstanceOf(KycNotVerifiedError);
  });

  it('throws SimSwapBlockedError when simSwapDetectedAt is set', async () => { /* … */ });
  it('throws TierLimitExceededError when amount > per-tx cap', async () => { /* … */ });
  it('does NOT throw VelocityExceededError even when daily usage is already at the cap', async () => {
    // getDailyUsage returns fiatTotal at dailyFiatMax; assertCanReleasePayout must still pass
    await expect(service.assertCanReleasePayout({ userId, fiatAmount: '10000', fiatCurrency: 'NGN', asset: 'USDT' })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm --filter @handshake-agent/api exec jest kyc-gate -t "assertCanReleasePayout"`
Expected: FAIL ("assertCanReleasePayout is not a function").

- [ ] **Step 3: Refactor the shared baseline out of `assertCanTransact`, then add the new method.** Extract steps 1–4b (SIM-swap → KYC status/tier → cooling-off → positive + per-tx cap) into a private helper returning nothing, and have BOTH methods call it. `assertCanTransact` then continues with 4c/5/6/7; `assertCanReleasePayout` stops after the baseline:

```ts
/** Baseline eligibility shared by transact + payout-release (no cumulative velocity). */
private async assertBaselineEligibility(input: {
  userId: string; fiatAmount: string; fiatCurrency: string;
}): Promise<{ user: LoadedUser; tierLimits: TierLimits }> {
  // … MOVE the current lines 184–268 (steps 1, 2, 2b, 3/4a, 4b) here verbatim,
  // returning { user, tierLimits } so assertCanTransact can continue with 4c–7.
}

async assertCanTransact(input: AssertCanTransactInput): Promise<void> {
  const { user, tierLimits } = await this.assertBaselineEligibility(input);
  // … EXISTING 4c (on-chain cap) + 5 (velocity) + 6 (weekly) + 7 (10-min) unchanged,
  //     using `user`/`tierLimits` from the baseline.
}

/**
 * Re-check gate for retrying a payout whose reserve/velocity was ALREADY consumed
 * at execute time. Runs the baseline (SIM-swap/KYC/tier/cooling-off/per-tx cap)
 * but intentionally OMITS the cumulative daily/weekly velocity counters — re-adding
 * this tx's amount would double-count and falsely block a legitimate retry (§3.3).
 */
async assertCanReleasePayout(input: {
  userId: string; fiatAmount: string; fiatCurrency: string; asset: string;
}): Promise<void> {
  await this.assertBaselineEligibility({
    userId: input.userId,
    fiatAmount: input.fiatAmount,
    fiatCurrency: input.fiatCurrency,
  });
}
```

(Use the real `LoadedUser` type returned by `identityRepo.loadUser`; if it is inline, name it via the repo's return type.)

- [ ] **Step 4: Run — verify green** (both the new tests AND all pre-existing `assertCanTransact` tests must still pass — the refactor must not change behavior).

Run: `pnpm --filter @handshake-agent/api exec jest kyc-gate`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/identity/application/kyc-gate.service.ts api/src/modules/identity/application/kyc-gate.service.spec.ts
git commit -m "feat(api): KycGateService.assertCanReleasePayout (velocity-free payout re-check)"
```

---

### Task 4: `AdminTreasuryPayoutRetryService` (orchestration — the money-path heart)

**Files:**
- Create: `api/src/modules/admin/application/admin-treasury-payout-retry.service.ts`
- Test: `api/src/modules/admin/application/admin-treasury-payout-retry.service.spec.ts`

**Interfaces:**
- Consumes: `TREASURY_READ_REPOSITORY` (`findPayoutQueueItem`), `TRANSACTION_REPOSITORY` (`findById`), `SETTLEMENT_OUTBOX_REPOSITORY` (`findByTransactionId`, `resetToPending`), `KycGateService.assertCanReleasePayout`, `COMPLIANCE_EVENT_REPOSITORY` (`listByStatus`, `create`), `AuditService.record`; error classes `AdminNotFoundError`, `TxnNotTriageableError`, `PayoutRetryBlockedError`.
- Produces: `retrySellPayout(payoutId: string, reason: string, adminId: string): Promise<TreasuryPayoutRetryResponse>`.

**Reserve-amount source:** the sell's re-check fiat amount is `txn.metadata.netFiatAmount` (written at `executeSell`); currency `txn.metadata.fiatCurrency`; asset `txn.metadata.asset`. Fail closed (`TxnNotTriageableError`) if any is missing/empty (mirrors `AdminTxnTriageService.requireReserve`).

- [ ] **Step 1: Write the failing unit tests** (all 9 cases from the spec §6):

```ts
import { Test } from '@nestjs/testing';
// … imports of tokens, service, errors

const makeTxn = (over: Partial<TransactionRecord> = {}): TransactionRecord => ({
  id: 'txn_1', proposalId: 'p1', userId: 'u1', type: 'sell', status: 'settling',
  idempotencyKey: 'key_1', requestChecksum: 'c', fxRateSnapshot: '1600',
  metadata: { netFiatAmount: '10000', fiatCurrency: 'NGN', asset: 'USDT' },
  processorTxRef: null, onChainTxHash: null, failureReason: null,
  pinVerifiedAt: new Date(), createdAt: new Date(), executedAt: new Date(), completedAt: null,
  ...over,
});

const payout = { id: 'po_1', transactionId: 'txn_1', beneficiaryLabel: 'x',
  reference: 'key_1', method: 'bank_transfer', asset: 'USDT', amount: '6.25',
  fiatAmount: '10000', requiresApproval: false, submittedAt: new Date() };

// wiring: treasury.findPayoutQueueItem→payout, transactions.findById→makeTxn(),
// outbox.findByTransactionId→{ id:'ob_1', settlementType:'processor_payout', status:'in_progress', … },
// kycGate.assertCanReleasePayout→resolves, compliance.listByStatus→{items:[],nextCursor:null}

it('happy path: re-arms the existing outbox row, audits, returns retry_enqueued', async () => {
  const res = await service.retrySellPayout('po_1', 'stuck payout', 'admin_1');
  expect(outbox.resetToPending).toHaveBeenCalledWith('ob_1');
  expect(kycGate.assertCanReleasePayout).toHaveBeenCalledWith({
    userId: 'u1', fiatAmount: '10000', fiatCurrency: 'NGN', asset: 'USDT',
  });
  expect(audit.record).toHaveBeenCalled();
  expect(res).toEqual({ payoutId: 'po_1', transactionId: 'txn_1', status: 'retry_enqueued', reChecked: true });
});

it('rejects an already-completed sell (no double-pay): 409, no re-arm', async () => {
  transactions.findById.mockResolvedValue(makeTxn({ status: 'completed' }));
  await expect(service.retrySellPayout('po_1', 'r', 'a')).rejects.toBeInstanceOf(TxnNotTriageableError);
  expect(outbox.resetToPending).not.toHaveBeenCalled();
});

it('rejects a terminal-failed (already-refunded) sell: 409, no re-arm', async () => {
  transactions.findById.mockResolvedValue(makeTxn({ status: 'failed' }));
  await expect(service.retrySellPayout('po_1', 'r', 'a')).rejects.toBeInstanceOf(TxnNotTriageableError);
  expect(outbox.resetToPending).not.toHaveBeenCalled();
});

it('rejects a non-sell txn: 409', async () => {
  transactions.findById.mockResolvedValue(makeTxn({ type: 'send' }));
  await expect(service.retrySellPayout('po_1', 'r', 'a')).rejects.toBeInstanceOf(TxnNotTriageableError);
});

it('rejects when no processor_payout outbox row exists: 409', async () => {
  outbox.findByTransactionId.mockResolvedValue(null);
  await expect(service.retrySellPayout('po_1', 'r', 'a')).rejects.toBeInstanceOf(TxnNotTriageableError);
});

it('idempotent re-entrancy: two retries both re-arm the SAME row (same reference)', async () => {
  await service.retrySellPayout('po_1', 'r', 'a');
  await service.retrySellPayout('po_1', 'r', 'a');
  expect(outbox.resetToPending).toHaveBeenNthCalledWith(1, 'ob_1');
  expect(outbox.resetToPending).toHaveBeenNthCalledWith(2, 'ob_1');
});

it('re-check failure (KYC): 403 PayoutRetryBlockedError, escalates, no re-arm', async () => {
  kycGate.assertCanReleasePayout.mockRejectedValue(new KycNotVerifiedError('status'));
  await expect(service.retrySellPayout('po_1', 'r', 'a')).rejects.toBeInstanceOf(PayoutRetryBlockedError);
  expect(compliance.create).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'u1', eventType: 'kyc_escalation', status: 'flagged',
  }));
  expect(outbox.resetToPending).not.toHaveBeenCalled();
});

it('re-check failure (open compliance block): 403, escalates, no re-arm', async () => {
  compliance.listByStatus.mockResolvedValue({ items: [{ id: 'ce_1' }], nextCursor: null });
  await expect(service.retrySellPayout('po_1', 'r', 'a')).rejects.toBeInstanceOf(PayoutRetryBlockedError);
  expect(outbox.resetToPending).not.toHaveBeenCalled();
});

it('unknown payout id: 404', async () => {
  treasury.findPayoutQueueItem.mockResolvedValue(null);
  await expect(service.retrySellPayout('nope', 'r', 'a')).rejects.toBeInstanceOf(AdminNotFoundError);
});
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm --filter @handshake-agent/api exec jest admin-treasury-payout-retry.service`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service:**

```ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import type { TreasuryPayoutRetryResponse } from '@handshake-agent/contracts';

import { AuditService } from '../../../core/audit/application/audit.service';
import { KycGateService } from '../../identity/application/kyc-gate.service';
import {
  COMPLIANCE_EVENT_REPOSITORY,
  type IComplianceEventRepository,
} from '../../compliance/application/ports/compliance-event.repository.port';
import {
  TREASURY_READ_REPOSITORY,
  type ITreasuryReadRepository,
} from '../../treasury/application/ports/treasury-read.repository.port';
import {
  TRANSACTION_REPOSITORY,
  type ITransactionRepository,
  type TransactionRecord,
} from '../../transactions/application/ports/transaction.repository.port';
import {
  SETTLEMENT_OUTBOX_REPOSITORY,
  type ISettlementOutboxRepository,
} from '../../transactions/application/ports/settlement-outbox.repository.port';
import { AdminNotFoundError } from '../domain/admin-errors';
import { TxnNotTriageableError } from '../domain/txn-triage-errors';
import { PayoutRetryBlockedError } from '../domain/treasury-operator-errors';

const PROCESSOR_PAYOUT = 'processor_payout';

/**
 * Go-readiness #2 — retry a STUCK settling sell payout, engine-brokered and
 * re-checked. FUNDS-SAFETY-CRITICAL (§3.1): never builds a ledger entry, never
 * re-sends a payout; it re-arms the EXISTING settlement outbox row (original
 * idempotency key) so the reconciler's `settleSellPayout` re-verifies with the
 * provider and finalises/refunds atomically. Rejects a completed payout (would
 * double-pay) and a terminal-failed one (already refunded). Re-checks the user
 * server-side at retry (§3.3); a since-flagged user is rejected + escalated, never
 * pushed through. Holds no Prisma import (§3.2).
 */
@Injectable()
export class AdminTreasuryPayoutRetryService {
  constructor(
    @Inject(TREASURY_READ_REPOSITORY)
    private readonly treasury: ITreasuryReadRepository,
    @Inject(TRANSACTION_REPOSITORY)
    private readonly transactions: ITransactionRepository,
    @Inject(SETTLEMENT_OUTBOX_REPOSITORY)
    private readonly outbox: ISettlementOutboxRepository,
    private readonly kycGate: KycGateService,
    @Inject(COMPLIANCE_EVENT_REPOSITORY)
    private readonly compliance: IComplianceEventRepository,
    private readonly audit: AuditService,
  ) {}

  async retrySellPayout(
    payoutId: string,
    reason: string,
    adminId: string,
  ): Promise<TreasuryPayoutRetryResponse> {
    // 1. Resolve server-side (never trust a client-supplied transactionId).
    const payout = await this.treasury.findPayoutQueueItem(payoutId);
    if (payout === null) throw new AdminNotFoundError('Payout');

    const txn = await this.transactions.findById(payout.transactionId);
    if (txn === null) throw new AdminNotFoundError('Transaction');

    // 2. Hard status gate (Gap A). Reject completed (double-pay) / failed
    //    (already refunded) / non-settling / non-sell.
    if (txn.type !== 'sell') {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} is a '${txn.type}', not a sell payout.`,
      );
    }
    if (txn.status === 'completed') {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} is already completed — retrying would double-pay.`,
      );
    }
    if (txn.status !== 'settling') {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} is '${txn.status}', not 'settling' — nothing to retry.`,
      );
    }
    const row = await this.outbox.findByTransactionId(txn.id);
    if (row === null || row.settlementType !== PROCESSOR_PAYOUT) {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} has no payout settlement to retry.`,
      );
    }

    // 3. Re-check the user server-side (Gap B, §3.3) — reject + escalate on fail.
    const { fiatAmount, fiatCurrency, asset } = this.reserveFields(txn);
    await this.reCheckOrEscalate(txn, fiatAmount, fiatCurrency, asset, reason, adminId);

    // 4. Re-drive via the engine: re-arm the EXISTING row (original key). The
    //    reconciler's settleSellPayout verifies + finalises/refunds atomically.
    await this.outbox.resetToPending(row.id);

    // 5. Immutable audit of the operator decision.
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Transaction:${txn.id}`,
      action: 'admin_override',
      before: { status: txn.status, outboxStatus: row.status },
      after: { action: 'payout_retry_enqueued', payoutId, reason },
    });

    return {
      payoutId,
      transactionId: txn.id,
      status: 'retry_enqueued',
      reChecked: true,
    };
  }

  /** netFiatAmount + fiatCurrency + asset from the sell metadata (fail closed). */
  private reserveFields(txn: TransactionRecord): {
    fiatAmount: string; fiatCurrency: string; asset: string;
  } {
    const meta = txn.metadata as Record<string, string | undefined>;
    const fiatAmount = meta.netFiatAmount;
    const fiatCurrency = meta.fiatCurrency;
    const asset = meta.asset;
    if (!fiatAmount || !fiatCurrency || !asset) {
      throw new TxnNotTriageableError(
        `Transaction ${txn.id} metadata is missing netFiatAmount/fiatCurrency/asset — cannot re-check.`,
      );
    }
    return { fiatAmount, fiatCurrency, asset };
  }

  /**
   * Re-check via the velocity-free payout gate + an open-compliance-block check.
   * On ANY failure: open a compliance escalation + audit, then throw a single
   * 403 PayoutRetryBlockedError. Never re-arms, never moves money.
   */
  private async reCheckOrEscalate(
    txn: TransactionRecord,
    fiatAmount: string,
    fiatCurrency: string,
    asset: string,
    reason: string,
    adminId: string,
  ): Promise<void> {
    let failure: string | null = null;
    try {
      await this.kycGate.assertCanReleasePayout({
        userId: txn.userId, fiatAmount, fiatCurrency, asset,
      });
    } catch (err: unknown) {
      failure = err instanceof Error ? err.message : 'kyc re-check failed';
    }
    if (failure === null) {
      const blocked = await this.compliance.listByStatus(
        { userId: txn.userId, status: 'blocked' },
        { limit: 1 },
      );
      if (blocked.items.length > 0) failure = 'user has an open compliance block';
    }
    if (failure === null) return;

    await this.compliance.create({
      userId: txn.userId,
      transactionId: txn.id,
      eventType: 'kyc_escalation',
      severity: 'high',
      screeningProvider: 'payout_retry_gate',
      ruleOrHit: failure,
      details: { reason, adminId, payoutRetry: true },
      status: 'flagged',
    });
    await this.audit.record({
      correlationId: randomUUID(),
      actorAdminId: adminId,
      subject: `Transaction:${txn.id}`,
      action: 'admin_review',
      before: { status: txn.status },
      after: { action: 'payout_retry_blocked', failure, reason },
    });
    throw new PayoutRetryBlockedError();
  }
}
```

- [ ] **Step 4: Run — verify green**

Run: `pnpm --filter @handshake-agent/api exec jest admin-treasury-payout-retry.service`
Expected: PASS (all 9).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/application/admin-treasury-payout-retry.service.ts api/src/modules/admin/application/admin-treasury-payout-retry.service.spec.ts
git commit -m "feat(api): AdminTreasuryPayoutRetryService — gated, re-checked, engine-brokered sell-payout retry"
```

---

### Task 5: DTO + controller endpoint + module wiring

**Files:**
- Modify: `api/src/modules/admin/presentation/dto/admin-treasury.dto.ts` (add `TreasuryPayoutRetryDto`)
- Modify: `api/src/modules/admin/presentation/admin-treasury.controller.ts` (add the route; inject the service)
- Modify: `api/src/modules/admin/admin.module.ts` (register `AdminTreasuryPayoutRetryService` as a provider)
- Test: `api/src/modules/admin/presentation/admin-treasury.controller.spec.ts` (if present — else covered by e2e in Task 6)

**Interfaces:**
- Consumes: `AdminTreasuryPayoutRetryService.retrySellPayout`, `TreasuryPayoutRetryRequestSchema`, `TreasuryPayoutRetryResponseSchema`.
- Produces: `POST /admin/treasury/payouts/:id/retry`.

- [ ] **Step 1: Add the DTO** to `admin-treasury.dto.ts`:

```ts
import { TreasuryPayoutRetryRequestSchema } from '@handshake-agent/contracts';

/** Body DTO for POST /admin/treasury/payouts/:id/retry (operator reason, required). */
export class TreasuryPayoutRetryDto extends createZodDto(
  TreasuryPayoutRetryRequestSchema,
) {}
```

- [ ] **Step 2: Add the endpoint** to `AdminTreasuryController` (inject the new service; mirror the `payouts/:id/approve` guards + parse):

```ts
  @Post('payouts/:id/retry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminStepUpGuard)
  @RequirePermission(
    'api_route',
    'POST /admin/treasury/payouts/:id/retry',
    'execute',
  )
  async retryPayout(
    @Param('id') id: string,
    @Body() dto: TreasuryPayoutRetryDto,
    @CurrentAdmin() admin: AdminContext,
  ): Promise<TreasuryPayoutRetryResponse> {
    return TreasuryPayoutRetryResponseSchema.parse(
      await this.payoutRetry.retrySellPayout(id, dto.reason, admin.adminId),
    );
  }
```

Add the constructor param `private readonly payoutRetry: AdminTreasuryPayoutRetryService,` and the schema/type imports.

- [ ] **Step 3: Register the provider** in `admin.module.ts` (`providers` array).

- [ ] **Step 4: Typecheck + boot-check** (DI resolves — no missing provider):

Run: `pnpm --filter @handshake-agent/api typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/presentation/dto/admin-treasury.dto.ts api/src/modules/admin/presentation/admin-treasury.controller.ts api/src/modules/admin/admin.module.ts
git commit -m "feat(api): POST /admin/treasury/payouts/:id/retry endpoint + wiring"
```

---

### Task 6: E2E — endpoint auth, happy path, double-pay reject, audit immutability

**Files:**
- Create: `api/test/admin-treasury-payout-retry.e2e-spec.ts` (mirror `api/test/admin-treasury.e2e-spec.ts` bootstrap: Testcontainers Postgres, seed an admin + role, **grant `api_route:POST /admin/treasury/payouts/:id/retry:execute`**, obtain a step-up token).

**Interfaces:** consumes the live `POST /admin/treasury/payouts/:id/retry`.

- [ ] **Step 1: Write the failing e2e** with these cases:

```ts
it('403 without the permission granted', async () => { /* admin lacking the perm → 403 */ });
it('403 without a fresh step-up', async () => { /* granted perm, no step-up token → 403 ADMIN_STEP_UP_REQUIRED */ });
it('retries a stuck settling sell payout → 200 retry_enqueued and resets the outbox row to pending', async () => {
  // seed: user, sell txn status 'settling' + metadata, processor_payout outbox row 'in_progress'
  // POST → 200; assert DB outbox row.status === 'pending'
});
it('rejects an already-completed sell payout → 409 (no double-pay)', async () => { /* seed completed txn → 409 */ });
it('writes an append-only, hash-chained audit row that cannot be mutated/deleted', async () => {
  // after a successful retry, read the AuditLog; assert the row exists with action 'admin_override'
  // and subject 'Transaction:<id>'; attempt an UPDATE/DELETE → rejected (trigger/immutability)
});
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm --filter @handshake-agent/api test:e2e -- admin-treasury-payout-retry`
Expected: FAIL.

- [ ] **Step 3: Make green** — no product code should be needed if Tasks 1–5 are correct; fix only test wiring (seeding, grants, step-up). If a real bug surfaces, fix the product code and note it.

- [ ] **Step 4: Run — verify green**

Run: `pnpm --filter @handshake-agent/api test:e2e -- admin-treasury-payout-retry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/test/admin-treasury-payout-retry.e2e-spec.ts
git commit -m "test(api): e2e for treasury payout-retry (auth, double-pay reject, audit immutability)"
```

---

### Task 7: Full-suite gate + push to PR #26

**Files:** none (verification + integration).

- [ ] **Step 1: Package gates** (all green, per §14):

Run:
```bash
pnpm --filter @handshake-agent/contracts test
pnpm --filter @handshake-agent/api exec eslint api/src/modules/admin api/src/modules/identity/application/kyc-gate.service.ts api/src/core/common/domain-exception.filter.ts
pnpm --filter @handshake-agent/api typecheck
pnpm --filter @handshake-agent/api test
pnpm depcruise
```
Expected: all PASS; depcruise clean (no admin→infrastructure/@prisma edge; no admin→ExecutionService).

- [ ] **Step 2: Targeted e2e** (the money-path suites): `pnpm --filter @handshake-agent/api test:e2e -- admin-treasury` — PASS (account for the known pre-existing main failures noted in memory; do not attribute them here).

- [ ] **Step 3: Push to PR #26.** Reconcile with the shared branch first (another worktree owns `feat/platform-hardening`):

```bash
git fetch origin
git rebase origin/feat/platform-hardening        # fast-forward; resolve if the other worktree pushed
git push origin HEAD:feat/platform-hardening      # updates PR #26 head
```
If the push is rejected as non-fast-forward, re-fetch + rebase, re-run Step 1, then push again. Do NOT force-push the shared branch.

- [ ] **Step 4: Confirm** PR #26 shows the new commits: `gh pr view 26 --json commits | tail`.

---

## Self-Review

**Spec coverage:**
- §2 semantics (retry stuck settling sell) → Task 4 gate. ✅
- §3 flow (resolve → gate → re-check → re-arm → audit → return) → Task 4. ✅
- §3 Gap A status gate (reject completed/failed/non-sell/no-outbox) → Task 4 Step 3 + tests. ✅
- §3 Gap B re-check + velocity double-count avoidance → Task 3 (`assertCanReleasePayout`) + Task 4 `reCheckOrEscalate`. ✅
- §3 reject + escalate on re-check failure → Task 4 `reCheckOrEscalate` + Task 2 error (403). ✅
- §4 endpoint + single-admin step-up + permission → Task 5 + Task 1 catalog + Task 6 auth e2e. ✅
- §5 safety-invariant mapping (no ExecutionService import; ports only; reuse original key) → Task 4 (resetToPending) + Task 7 depcruise. ✅
- §6 test plan (9 unit + audit-immutability e2e) → Tasks 4 + 6. ✅
- File-map deviations (reuse global AuditService; admin-module placement) → honored across tasks. ✅

**Placeholder scan:** the `/* … */` markers in test snippets are illustrative arrange-blocks the implementer fills from the shown `makeTxn`/wiring; every product-code step has complete code. No TBD/TODO. ✅

**Type consistency:** `retrySellPayout(payoutId, reason, adminId)` and the response `{ payoutId, transactionId, status:'retry_enqueued', reChecked }` are identical in contracts (Task 1), service (Task 4), controller (Task 5), and tests. `assertCanReleasePayout({userId,fiatAmount,fiatCurrency,asset})` is identical in Tasks 3 + 4. ✅

**Known limitation carried from spec §3:** the autonomous reconciler still re-drives `pending` settling payouts without the re-check — a follow-up slice, explicitly out of scope.
