# Admin Dashboard — Phase 2 (Users & KYC Review) Plan

> REQUIRED SUB-SKILL: subagent-driven-development / executing-plans. Checkbox steps, TDD.

**Goal:** Operator control over end-user accounts: search/filter users, a consolidated detail view (KYC, tier, devices, balances/ledger, transactions, beneficiaries), audited+step-up actions (adjust tier, suspend/reactivate, force PIN reset, manage devices / trigger SIM-swap re-verification, close account), and a KYC review queue (list `pending_review`, view submitted data, approve/reject with reason — the manual override path for the mocked `KycProvider`).

**Architecture:** New admin read/command services in `modules/identity` (and a small aggregation that reads wallets/transactions/beneficiaries via their exported services/ports) + admin controllers under the `admin` surface, RBAC-gated (`Users`/`KYC` permission categories), audited via `AuditService`, step-up on sensitive actions. Never bypass the engine: admin changes the user record/KYC state; the engine still re-checks at txn time (§3.3). web-admin pages consume them.

## Global Constraints
- Server-side authz on every endpoint (`@RequirePermission`, default-deny); FE gate is UX. Sensitive actions (tier change, suspend/close, PIN reset, SIM-swap reverify) require `AdminStepUpGuard`. (Phase 0)
- Every action audited (before→after, actorAdminId) via `AuditService` with the right `AuditAction` (`kyc_state_change`, `pin_reset`, `device_bind`, `admin_update`, `admin_override`). (NFR-3)
- Admin must NOT move money or bypass gates: a tier bump updates `User.kycTier`; the engine re-validates limits at txn time. PIN reset clears the hash + forces re-set; it never reveals/sets a PIN. (§3.1/§3.3/§3.4)
- Cross-boundary shapes from `@handshake-agent/contracts`. Strict TDD; ~100% on each state transition + audit + step-up gating. depcruise clean (admin reads other modules only via their exported application services/ports — no cross-module repo imports).

## Existing surface to build on (verify during Task 1)
- `modules/identity`: `User` (status provisional/active/suspended/deactivated; kycStatus; kycTier; pinnedDeviceId; pinHash; simSwapDetectedAt; deletedAt), `KycProfile` (status/tier/nin/bvn/idDoc/liveness/names/reviewedByAdminId/rejectionReason), `Device` (trustState unbound/bound/revoked), `KycGateService`, `MockKycProvider`, identity repos.
- `core/auth`: `PinService` (`setPin`/reset path), `SessionService`, the `PIN_REPOSITORY` (pinHash/failure state).
- Exported reads: `WalletService`/`WALLET_REPOSITORY` + `LEDGER_REPOSITORY` (balances/ledger), transactions read (`ITransactionRepository`), `BeneficiaryService` (list).

## Files
**contracts** `admin/`: `user-mgmt.dto.ts` (search/list/detail/tier/status/pin-reset/device/sim-swap/close), `kyc-review.dto.ts` (queue list, submission detail, approve/reject); `permissions.ts` += `Users`/`KYC` catalog entries + role grants (compliance: KYC write + Users read; ops: Users read/write minus close; support: Users read).
**api** `modules/identity/`:
- `application/admin-user-admin.service.ts` (search/list, detail-aggregate, adjustTier, setStatus suspend/reactivate/close, forcePinReset, listDevices/revokeDevice, triggerSimSwapReverify) — each audited + (sensitive) require a fresh step-up flag passed from the guard.
- `application/admin-kyc-review.service.ts` (listPendingReview, getSubmission, approve(tier)/reject(reason) → update KycProfile + User.kycStatus/kycTier + audit `kyc_state_change`, set `reviewedByAdminId`).
- new ports/methods on identity repos where missing (e.g. `searchUsers(query)`, `setKycTier`, `setUserStatus`, `clearPin`, `setSimSwapDetectedAt`, `revokeDevice`, `listPendingKyc`, `setKycDecision`). Add to the identity application ports + prisma repos (+ integration specs).
- `presentation/admin-users.controller.ts` (note: distinct from the Phase-0 admin-USER (admin accounts) controller — name it `admin-end-users.controller.ts` to avoid confusion) + `admin-kyc-review.controller.ts`. Routes: `GET /admin/users` (search), `GET /admin/users/:id` (detail), `PATCH /admin/users/:id/tier`, `PATCH /admin/users/:id/status`, `POST /admin/users/:id/pin-reset`, `GET /admin/users/:id/devices`, `DELETE /admin/users/:id/devices/:deviceId`, `POST /admin/users/:id/sim-swap-reverify`, `GET /admin/kyc/queue`, `GET /admin/kyc/:userId`, `POST /admin/kyc/:userId/approve`, `POST /admin/kyc/:userId/reject`. Sensitive ones + `AdminStepUpGuard`.
- Wire into `AdminModule` (imports IdentityModule + WalletsModule + TransactionsModule + BeneficiariesModule for the detail aggregate; provide the two services).
**web-admin** `app/users/`, `app/kyc/` + `components/admin/users-*`, `kyc-review-*`.

## Tasks
1. **contracts + permissions** — DTOs + `Users`/`KYC` catalog entries + role grants (+ spec). Commit `feat(contracts): admin user-mgmt and KYC-review DTOs + permissions`.
2. **identity repo methods** (+ integration specs) — `searchUsers`, `getUserAdminView`, `setKycTier`, `setUserStatus`, `clearPinAndUnpinDevice`, `setSimSwapDetectedAt`, `revokeDevice`, `listPendingKyc`, `applyKycDecision`. TDD. Commit `feat(api): identity admin repository methods`.
3. **AdminUserAdminService + AdminKycReviewService** (+specs, mock ports + AuditService) — each action validates state, mutates via the repo, audits, returns the updated view; `forcePinReset` clears pinHash + unpins device + audits `pin_reset`; `triggerSimSwapReverify` sets `simSwapDetectedAt` (engine then blocks until re-verify) + audits; `applyKycDecision` updates KycProfile+User + audits `kyc_state_change`. Commit `feat(api): admin user-management and KYC-review services`.
4. **detail aggregate** — `getUserAdminView(userId)` composes identity (user+kyc+devices) + wallets (balances) + ledger (recent entries) + transactions (recent) + beneficiaries (list), each via the owning module's exported service/port. Commit within Task 3 or its own.
5. **controllers + module wiring + e2e** — RBAC-gated + step-up; an e2e (testcontainers): admin lists users → views detail → adjusts tier (step-up) → audit row written; KYC queue → approve → user becomes verified+tiered + audit. Commit `feat(api): admin end-user + KYC-review controllers and e2e`.
6. **web-admin** — users page (search/filter table + detail drawer with the aggregate sections + action modals with step-up) + KYC review queue (list + submission detail + approve/reject with reason). 4 async branches; Vitest. Commit `feat(web-admin): user management and KYC review pages`.
7. **gate** — `pnpm typecheck`/`test`/`depcruise`; admin e2e green. Commit; update memory.

## Self-review
- Covers spec §6 Phase 2 (user search/detail/actions + KYC review). Money-safety: admin never moves funds; tier/KYC changes are record edits re-checked by the engine; PIN reset never reveals a PIN. Audit + step-up on every sensitive action. Cross-module reads via exported services (depcruise-safe).
