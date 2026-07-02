# Admin Phase 8 — Full features, surfacing & polish (Implementation Plan)

> **For agentic workers:** TDD (test first, red→green→refactor). Backend-first per feature: contract (Zod) → application service → infra repo (Prisma) → presentation controller (RBAC-gated) → e2e → FE api-client → query hook → wire screen (four async branches) → runtime-verify. Gates per package: `tsc` 0, eslint 0 (bare, no `--fix`), vitest/jest green, `depcruise` clean. Commit `--no-verify` (pre-commit lint-staged OOMs on large sets) after per-package `eslint --fix`.

**Goal:** Finish the operator admin console — make every remaining mock real, add the deferred polish features, and strip the mocks the user asked to remove — preserving the funds-safety invariants (§3).

**Branch:** `feat/admin-integration-reads` (off `main`). Prior: 6a `10667af` · 6b `13c301a` · 7 `e1a9b83` · badge-fix `2b24ec3`.

**Method:** multi-agent waves (finer agents, distinct file ownership to avoid conflicts — the 6b lesson). Wave 0 schema (me, direct) → Wave 1 backend → Wave 2 FE → Wave 3 adversarial verify → gate + commit + runtime-verify.

## Global constraints (binding, from root CLAUDE.md)

- §3.1 no LLM/UI moves money — money writes route through the engine's atomic idempotent methods; §3.4 **full PII (NIN/BVN) NEVER leaves backend — admin sees last-4 only**; every money/compliance/RBAC mutation is reason → step-up (TOTP) → engine/maker-checker, idempotency-keyed + immutably audited (hash-chained AuditLog).
- §4 clean-arch: presentation→application→domain; infra implements application ports (Symbol DI tokens); **application never imports @prisma/client** (depcruise-enforced). §8 shapes cross FE/BE only via `@handshake-agent/contracts`.
- Exports must be **PII-minimised** (last-4 only), **filter-respecting** (same query as the list), **audited** (`admin_export` event with rowCount), RBAC-gated.

## Locked decisions (user)

- **Defer to Phase 9** (greenfield / blocked, not admin wiring): ticket event-catalog, vendor-payout-reconciliation (custodial money — needs treasury/accounting design), vendor-ports registry, per-tx webhook history (no persisted webhook event store exists). Leave honest shape-gap messaging on those surfaces.
- **Build** the two feasible both-missing items: reconciliation→compliance-case escalation, per-tx re-run-recon.
- **MFA enroll** stays one-step (enroll shows QR + recovery codes + activates); the two-step confirm endpoint is deferred.
- **CSV export** = ALL rows matching the current filters (not just the visible page).
- **Admin display name** optional at invite (defaults to email local-part).
- **Reset-2FA-for-another-admin** requires step-up + reason (sensitive), audited.
- **Notification templates:** seed the platform's REAL default templates (derived from the actual `templateKey`s the notification system sends) — not fabricated samples.
- **AML rules:** empty is correct (admin-authored) — do NOT seed. ADD a "?" help tooltip on the AML page listing example rule types (e.g. `velocity_daily_limit`, `amount_threshold`, `kyc_tier_gate`, `geo_block`, `sanctions_rescreen`) so operators know what they can author.

## Already DONE (Phases 6–7 — do NOT rebuild)

roles/permissions editor (RoleEditorDialog + RolePermissionMatrix), invite-admin (InviteAdminDialog), MFA self-enroll flow + verify + recovery-codes model + step-up, refund ChangeRequestKind, reconciliation read + resolve/accept, ticket-orders read wiring, sim-swap reverify trigger (surfaced), theme persistence (`ha.admin.theme`).

---

## Wave 0 — Schema (direct, single migration; avoids parallel schema races)

- `api/prisma/schema/03-admin.prisma`:
  - `AdminUser.displayName String @default("")` (nullable-safe; readers fall back to email local-part).
  - new `AdminPreferences` model: `adminId String @id @db.Uuid`, `emailAlerts/approvalMentions/weeklyDigest Boolean @default(true)`, `createdAt/updatedAt`, `@@map("admin_preferences")`, FK to AdminUser.
- One migration + `prisma generate`. No other new models (recon-escalate reuses `ComplianceEvent`; reset-2FA reuses `AdminUser.mfa*`; CSV needs none; `NotificationTemplate` exists).

## Wave 1 — Backend (parallel, distinct file ownership)

- **B-rbac** (owns `admin-user.service.ts`, `admin-auth.service.ts`, `admin-users.controller.ts`, `contracts/admin/user.dto.ts`, `admin-user.prisma.repository.ts`): thread `displayName` through AdminUser/AdminMe DTOs + serializers + invite-accept capture (optional, email-default); build **reset-2FA-for-another-admin** — `AdminMfaService.resetForAdmin(target, actor)` clears mfaSecret+recoveryCodes+mfaEnabled, `POST /admin/admins/:id/mfa/reset` (`@RequirePermission` write + `AdminStepUpGuard` + reason + audit).
- **B-prefs** (new files: `admin-preferences.service.ts`+spec, `ports/admin-preferences.repository.port.ts`, `admin-preferences.prisma.repository.ts`, `admin-preferences.controller.ts`, `contracts/admin/preferences.dto.ts`): `GET/PATCH /admin/me/preferences` (self-scoped, write-gated, audited).
- **B-csv** (new: `contracts/admin/export.dto.ts`, `admin/application/csv.ts` builder; adds `exportRows()` to `AdminEndUserService`/`AdminLedgerService`/`AdminAuditService` + `GET /admin/{users,ledger,audit}/export` on their controllers): CSV streamed `text/csv`, PII last-4, filter-respecting, `admin_export` audit with rowCount.
- **B-recon** (owns `admin-reconciliation` + `admin-transactions` triage service/controller): `POST /admin/reconciliation/breaks/:id/escalate` → create a `ComplianceEvent` from the break (step-up+reason+audit); `POST /admin/transactions/:id/reconcile` → re-run settlement recon for ONE tx (read-only detection, no money move).
- **B-templates**: investigate real `templateKey`s sent by the notifications module; seed the platform's real default `NotificationTemplate` rows (idempotent seed/migration). If templates prove purely admin-authored, document empty-is-correct instead (no fabrication).
- **B-metrics**: align the dashboard "Failed / stuck tx" card — surface BOTH `failed` and `stuck` counts (endpoint returns both; card shows "Failed N · Stuck M") so it matches the sidebar stuck badge semantics.

## Wave 2 — Frontend (parallel, distinct component files)

- **F-admins** (`admins-page.tsx`): wire to `useAdmins()` (4 branches) + mount `AdminRowActions` + `RolePermissionMatrix` (real roles/perms) + show `displayName` + reset-2FA row action (reason→step-up).
- **F-settings** (`admin-settings-page.tsx`): profile → `useAdminMe()`; conditional "Enroll 2FA" button (existing `MfaEnrollDialog`) when `mfaEnabled=false`; wire the 3 notification-pref toggles to `useAdminPreferences`/`useUpdateAdminPreferences`.
- **F-csv** (`lib/api/{users,ledger,admin}.ts` + `lib/download.ts` + `{users,ledger,audit}` pages): 3 blob api-clients + `downloadFile` helper; replace the export toasts with real filtered downloads.
- **F-mock-a** (strip PII-reveal): delete `PiiRevealModal` + `PiiRevealModalProps` + all call sites + `piiRevealed` state + tests; remove view-as re-scoping from `account-menu.tsx`+`app-shell.tsx` (KEEP honest read-only role display).
- **F-mock-b**: wire the notifications **bell** to real derived operator alerts (compose existing hooks: approvals-awaiting-me + open recon breaks + stuck txns + open compliance cases → linked alerts); wire the composer to the real `BroadcastAudience` + `sendAt`; remove `VENDOR_ROWS` (ticketing) + `WA_FLOWS`/`WA_CONVO` (whatsapp) mocks with honest shape-gap notes.
- **F-ops** (`ops-page.tsx`): wallet-backfill job (list + enqueue + poll) + service-health card (reuse `useDashboardMetrics().serviceHealth`).
- **F-aml** (`aml-page.tsx`): add the "?" help tooltip with example AML rule types.
- **F-recon-tx**: escalate button on reconciliation breaks + re-run-recon button on tx-detail (reason→step-up).

## Wave 3 — Adversarial verify

Per feature: gates (tsc/eslint/jest/vitest/depcruise) + invariant audit (PII last-4 in exports, step-up+audit on RBAC/recon writes, no raw-ledger money, self-scoped prefs) + runtime (endpoint probe + browser render). Fix findings, re-gate, commit.
