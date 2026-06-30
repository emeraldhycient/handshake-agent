# Admin Dashboard — Phase 3 (Transactions / Ledger / Compliance / Treasury) Plan

> REQUIRED SUB-SKILL: subagent-driven-development / executing-plans. TDD, frequent commits. This phase touches the MONEY PATH — every fund-affecting admin action routes through the EXISTING atomic, idempotent engine methods; NEVER a raw ledger edit.

**Goal:** Operator oversight + audited, engine-brokered control of money flows: transaction list/search/detail + triage of stuck `settling`/`failed` txns with **refund / retry / mark-failed** (via the engine's atomic refund/outbox paths), a ledger viewer + integrity check, a compliance disposition console (events/AML rules/Travel-Rule/SAR-STR/denylist), and treasury read (master balances/exposure/alerts/withdrawal policy) + beneficiary cooling-off override.

**Architecture:** Read methods added to the transactions/ledger/compliance/treasury repos; admin command services that call the engine's existing `settle*RefundAtomic` (refund/mark-failed) and `SettlementOutbox` (retry) — idempotent + audited + step-up; admin controllers under the admin surface, RBAC-gated (`Transactions`/`Ledger`/`Compliance`/`Treasury`/`Beneficiaries` perm categories); web-admin pages. The sanctions denylist becomes a `string[]` entry in the Phase-1 config registry (edited via the existing `/admin/settings` API).

## Global Constraints
- **No raw ledger edits.** Admin refund/mark-failed = call `settleSellRefundAtomic`/`settleSendRefundAtomic`/`settleSwapRefundAtomic` (reverse reserve, mark failed, CompensationRecord, velocity reversal) keyed by the txn's idempotencyKey → **idempotent**. Admin retry = re-drive via `SettlementOutbox`. (§3.1)
- Every fund/limit-affecting action: `AdminStepUpGuard` + audit (`admin_override`/`admin_review`/`config_change`) with before→after. (NFR-3)
- Server-side authz default-deny on every endpoint. Cross-module reads via exported services/ports only (depcruise clean).
- Strict TDD; ~100% on the refund/retry/mark-failed paths, the ledger integrity check, and compliance disposition. Cross-boundary shapes from contracts.
- Compliance/treasury models already exist in the schema (`01-audit.prisma`, `05-pricing.prisma`, `04-wallets.prisma`) — wire services/repos, don't redesign.

## Tasks (each: contracts → api repo/service/controller → web-admin → tests → gate; commit per task)

### A — Transactions & Ledger oversight (read)
- **contracts:** `admin-txn.dto.ts` (txn search query {status?,type?,userId?,from?,to?,cursor?,limit?}; txn list item; txn detail {…, ledgerLegs[], statusTimeline[], providerRefs, hashes}); `admin-ledger.dto.ts` (account query; ledger entry view; integrity-check result {balanced, legCount, brokenAt?}). Perms: `Transactions` (read), `Ledger` (read) + web_page/menu.
- **api repo:** `ITransactionRepository.listAll(filter,page)` + `listByStatus(status,page)` + `getDetailWithLegs(id)` (txn + its LedgerEntry legs + status timeline derived from timestamps); `ILedgerRepository.listEntries(filter)` + `verifyTransactionIntegrity(txnId)` (sum of signed legs per currency == 0; balanceAfter monotonic per account-sequence) + `getAccountHistory(accountType,accountId,currency,limit)` + `verifyAccountIntegrity(...)`. Integration specs.
- **api service+controller:** `AdminTxnOversightService` (list/search/detail) + `AdminLedgerService` (account history, integrity) → `admin-transactions.controller` (`GET /admin/transactions`, `GET /admin/transactions/:id`) + `admin-ledger.controller` (`GET /admin/ledger?accountType=&accountId=&currency=`, `POST /admin/ledger/verify/:transactionId`). RBAC read-gated.
- **web-admin:** transactions page (search/filter table + detail drawer: legs/timeline/refs/hashes) + ledger viewer page (account picker + entries + verify button).

### B — Engine-brokered triage actions (MONEY PATH — extra care)
- **contracts:** `admin-txn-action.dto.ts` (refund/mark-failed reason; retry; responses). Perms: `Transactions` `execute`.
- **api service:** `AdminTxnTriageService` injecting `ISettlementRepository` + `ITransactionRepository` + `SettlementOutbox` repo + `AuditService`:
  - `markFailedAndRefund(txnId, reason, adminId)` — load txn (must be `settling`; else `TxnNotTriageableError`); by `type` call the matching `settle*RefundAtomic` with the reserve params parsed from `metadata` + `velocityReversal: true`; audit `admin_override` (before/after status). Idempotent (re-call on already-failed → no-op success).
  - `retrySettlement(txnId, adminId)` — find the txn's `SettlementOutbox` row; reset to `pending`/enqueue so the reconciliation worker re-drives it (do NOT re-execute inline); audit `admin_override`.
  - (Reconcile already exists — fold the existing `/admin/wallets/reconcile` under this surface conceptually.)
  - controller: `POST /admin/transactions/:id/mark-failed`, `POST /admin/transactions/:id/retry` (both `+AdminStepUpGuard`, `Transactions execute`).
- **tests (~100%):** mark-failed routes through `settle*RefundAtomic` (asserted, never a raw ledger write); idempotent re-call; non-settling txn rejected; retry re-enqueues the outbox; audit written. An e2e: create a settling txn (via the engine reserve path) → admin mark-failed → reserve reversed (ledger balance restored) + status failed + CompensationRecord + audit.

### C — Compliance console
- **contracts:** `admin-compliance.dto.ts` (event queue/detail, disposition request {status: approved|blocked|dismissed, comment}; sanctions-record view; AML-rule CRUD; travel-rule list; SAR/STR draft/submit). Perms: `Compliance` (read/write/execute) + web_page/menu.
- **api:** `IComplianceEventRepository` += `listByStatus(status,filter,page)`, `findById`, `updateDisposition(id,{status,adminId,comment,at})` (append disposition; the immutable trail is the AuditLog). New `IAmlRuleRepository` (list/create/update — version bump on update) + `ITravelRuleRepository.list` + `IComplianceReportRepository` (create draft / submit / list). `AdminComplianceService` (dispose event + audit `admin_review`; AML-rule CRUD + audit `config_change`; travel-rule list; SAR/STR draft→submit + audit). `admin-compliance.controller` routes. Denylist: register `compliance.sanctionsDenylist` (valueType `string[]`) in the Phase-1 SETTING_REGISTRY → edited via `/admin/settings` (no new endpoint).
- **web-admin:** compliance page (flagged-event queue + disposition, AML-rule editor, travel-rule list, SAR/STR drafts, denylist link to settings).

### D — Treasury + beneficiary override
- **contracts:** `admin-treasury.dto.ts` (network/asset balances, exposure, alerts, withdrawal policy) + `admin-beneficiary.dto.ts` (cooling-off view + override). Perms: `Treasury` (read/write/execute), `Beneficiaries` (read/write).
- **api:** `TreasuryReadService` (master balances per network/asset from Wallet+WalletBalance + ledger treasury accounts; read `TreasuryExposure`/`TreasuryAlert` + `acknowledgeAlert(id,adminId,note)` + audit; read `WithdrawalPolicy`). `AdminBeneficiaryService` (list a user's beneficiaries + `overrideCoolingOff(beneficiaryId, adminId)` → clear `firstUseLockedUntil` + audit `admin_override`). controllers. Fold the existing wallet reconcile/backfill under the treasury surface.
- **web-admin:** treasury page (balances/exposure/alerts/policies + reconcile trigger) + beneficiary cooling-off override (in the user detail or a beneficiaries view).

### E — gate
- Full `pnpm typecheck`/`test`/`depcruise`; admin e2es (incl. the triage e2e) green; verify a refund via the API restores the ledger balance. Update memory.

## Self-review
- Money-path safety: B routes exclusively through the existing atomic idempotent `settle*RefundAtomic`/outbox — no raw ledger edit; step-up + audit on every action; A/C/D mutations audited. Compliance disposition appends + audits (the AuditLog is the immutable trail). Cross-module via exported ports (depcruise). Denylist reuses the Phase-1 settings pipeline rather than a bespoke endpoint.
- Sub-areas A–D are independently shippable; sequence A (read) → B (money path, careful) → C → D → E.
