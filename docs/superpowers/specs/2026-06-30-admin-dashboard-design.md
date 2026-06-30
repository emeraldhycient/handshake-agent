# Admin Dashboard — Design Spec

**Date:** 2026-06-30
**Branch:** `feat/admin-dashboard` (off `feat/web-agent-vertical`)
**Status:** Approved (architecture + phasing); implementation autonomous, phase by phase.

---

## 1. Goal

A granular, full-control operations console for Handshake Agent: a NestJS `admin` capability (RBAC-gated API endpoints + immutable audit) and a **separate** Next.js admin app (`web-admin/`), giving operators control over the entire platform — admin auth/RBAC, layered config & service registry, pricing/treasury economics, catalog, KYC config, users, KYC review, transactions & engine oversight, ledger, compliance, treasury, beneficiaries, notifications/templates, WhatsApp, tickets, agent config, and dashboards/metrics.

This realizes PRD NFR-3 (immutable audit of every proposal/confirmation/authorization/execution), NFR-9 (operations/compliance console), NFR-10 (treasury/anomaly alerting), and the CLAUDE.md §7 layered-config / service-registry vision.

## 2. Non-negotiable constraints (from CLAUDE.md §3 + task brief)

1. **Model proposes / engine disposes (§3.1).** Admin configures gates and triggers **engine-brokered** actions; it never constructs or submits a transaction, and never hand-edits the ledger. Manual refund/retry/mark-failed are new **audited, idempotent** methods on the deterministic engine, not raw DB writes.
2. **Agent has no DB (§3.2).** Untouched. The admin "Agent" surface is **read-only** over the proposing layer (model id/params/system-prompt) + conversation/intent logs. `dependency-cruiser` stays clean.
3. **KYC/limits/sanctions re-checked server-side (§3.3).** Admin tunes the gates; the engine still re-checks at transaction time. A tier change updates the record, not the enforcement point.
4. **Identity ≠ phone number (§3.4).** Unchanged.
5. **Admins are a separate principal.** Separate table (`AdminUser`), separate auth (password + TOTP), separate sessions (`AdminSession`), separate app (`web-admin`), separate token storage. Never reuse a user's PIN/JWT/session.
6. **RBAC, least privilege.** Every endpoint authorized server-side by a required permission; default-deny. The FE gate is UX only.
7. **Immutable audit.** Every admin action (who/when/what/before→after/IP) recorded in the append-only, hash-chained `AuditLog`. Money-affecting or limit-changing actions require admin **step-up** (re-auth).
8. **Secrets never in UI.** `DATABASE_URL`, API keys, signing keys stay env-only. Admin edits only the DB `AppSetting` (business-tunable) layer, hot-reloaded with cache invalidation. `isSecret` settings are never returned; `isEditable=false` settings reject writes.
9. **Cross-boundary shapes via `@handshake-agent/contracts`** (Zod + inferred types). **Strict TDD**, ~100% on admin authz, audit logging, config resolution, and any money-affecting action. Tokens-only UI, four async branches.

## 3. Locked decisions

- **Admin UI:** a **separate `web-admin/` app** (third root app), strongest origin isolation. Reuses `@handshake-agent/contracts`; shares no auth/state with `web/`.
- **Sequencing:** one comprehensive spec (this doc) covering all surfaces; implement phase by phase, **pushing through autonomously**, pausing only on genuine blockers or irreversible/destructive decisions.
- **Config wiring:** wire the DB-override (`AppSetting`) layer through **all 18 `TODO(config-admin)` sites**, including money-path values (limits/spreads/fees), via a synchronously-readable `EffectiveConfigService`.

## 4. What already exists (the head start)

The Prisma schema already models the entire admin/audit/compliance domain — this is largely a "wire up the modeled domain" job, not design-from-scratch.

- `api/prisma/schema/03-admin.prisma`: `AdminUser` (Argon2id `passwordHash`, `status` lifecycle, `mfaEnabled`/`mfaSecret`/`mfaRecoveryCodes`, `roleId`), `AdminSession` (hashed `tokenHash`, `expiresAt`, `revokedAt`, `ipAddress`/`userAgent`), `Role` (`isBuiltin`), `Permission` (`resourceType` = `api_route|web_page|menu_item`, `resourceId`, `action` = `read|write|delete|execute`, `category`), `RolePermissionAssignment`, `AdminInvitation` (single-use, TTL, hashed token).
- `api/prisma/schema/01-audit.prisma`: `AuditLog` (hash-chained, append-only; `correlationId`, `actor`, `actorUserId`/`actorAdminId`, `subject`, `action` enum, `details`/`before`/`after` JSON, `prevHash`/`currentHash`), `ComplianceEvent`, `SanctionsRecord`, `AmlRule`+`AmlRuleEvaluation`, `TravelRuleData`, `VelocityCounter`, `ComplianceReport` (SAR/STR).
- `api/prisma/schema/00-config.prisma`: `AppSetting` (`key`, JSON `value`, `scope` = `global|tier|provider`, `scopeValue`, `isSecret`, `isEditable`, `updatedByAdminId`). **No repository/service yet.** 18 `TODO(config-admin)` markers in `api/src/core/config/configuration.ts`.

Existing ad-hoc admin to fold in: `api/src/modules/admin/` — `AdminWalletsController` (`POST /admin/wallets/backfill-networks`, `GET /admin/wallets/backfill-runs/:id`, `POST /admin/wallets/reconcile`, Bull Board at `/admin/queues`) behind a fail-closed `AdminTokenGuard` (env `ADMIN_API_TOKEN`), with an explicit comment to swap it for `AdminSessionGuard` once RBAC exists.

### Conventions to follow (verified)
- DI tokens are `Symbol('NAME')`; ports in `application/ports/*.port.ts`; repos in `infrastructure/` bound `{ provide: SYMBOL, useClass: Impl }`; mock/real via `useFactory` + ConfigService.
- Controllers: `extends createZodDto(Schema)` over `@handshake-agent/contracts`; global `ZodValidationPipe`; guards via `@UseGuards`; `@CurrentUser()`-style param decorators.
- Contracts: `packages/contracts/src/dto/*.ts` — Zod schema + `z.infer` type; subpath exports.
- Web: thin `app/` → `components/<feature>` (loading/error/empty/data) → `lib/api` (single axios; `Idempotency-Key` + Bearer interceptors; 401 handling) → `lib/query` (TanStack) + `lib/store` (zustand). shadcn `radix-vega`, Tailwind v4 `globals.css` tokens.
- Tests: Jest unit (inline config in `api/package.json`), e2e supertest (`test/jest-e2e.json`), integration via `@testcontainers/postgresql`. Strict TDD.

## 5. Architecture

### 5.1 Monorepo additions
- **`web-admin/`** (`@handshake-agent/web-admin`): Next 16, App Router, same stack/conventions as `web/`. Wiring: add to `pnpm-workspace.yaml`, `turbo.json` (inherits tasks), root + app `tsconfig` contracts alias, `transpilePackages: ['@handshake-agent/contracts']`, `outputFileTracingRoot`, own `.env.example`, own `.dependency-cruiser.cjs` layering rules, CI coverage, `test` script (Vitest). Updates CLAUDE.md §2 ("two apps" → three).
- **API:** `core/audit/` (cross-cutting) + an expanded `modules/admin` security core + `EffectiveConfigService` + per-domain admin modules.

### 5.2 API module map
| Module | Responsibility |
|---|---|
| `core/audit/` | `AuditService` (append + verify chain) behind a port; append-only hash-chained `AuditLogRepository`; `@Global()` so any module injects it. Daily `audit_chain_check` BullMQ job. |
| `modules/admin` → **AdminAccessModule** | AdminUser/Session/Role/Permission/Invitation repos; `AdminAuthService` (email+password Argon2id + TOTP); `AdminMfaService` (enroll/verify/recovery); `AdminInvitationService`; `AdminUserService`; `RoleService`; `PermissionCatalogService`; `AdminStepUpService`; `AuthorizationService` (resolve effective permissions). Presentation: `AdminSessionGuard`, `PermissionGuard` + `@RequirePermission`, `AdminStepUpGuard`, `@CurrentAdmin()`; controllers auth, `/admin/me`, admin-users, roles, permissions, invitations, sessions. Seeds built-in roles + permission catalog; bootstraps first super_admin. Exports guards/decorators + `AuthorizationService`. |
| **AdminConfigModule** (extends `modules/config`) | `EffectiveConfigService` (layered DB›env›JSON merge with sync snapshot + Redis pub/sub invalidation); per-key Zod validation registry; `AdminSettingsService` (CRUD + `isEditable`/`isSecret` enforcement + audit). Surfaces: settings, service/capability registry, pricing/economics, catalog (assets/currencies/networks/provider-ids), KYC config (tier limits/velocity/Travel-Rule thresholds). |
| **AdminOpsModule** | Users (search/detail/actions), KYC review queue, transactions oversight, ledger viewer, treasury/wallets, beneficiaries. Imports identity/transactions/wallets/beneficiaries; delegates every money action to those modules' engine-brokered services. |
| **AdminComplianceModule** | ComplianceEvent disposition; SanctionsRecord view; denylist mgmt; AML rule CRUD (versioned); Travel Rule records; SAR/STR reports. Imports compliance. |
| **AdminCommsModule** | Notification templates CRUD/preview/enable; WhatsApp flow/template/opt-in/webhook-health; ticket vendor registry/commission/enablement. |
| **AdminAgentModule** | Agent model/params + system-prompt config **read-only**; enablement; conversation/intent logs. |
| **AdminMetricsModule** | Volumes/success rates, revenue (spread+fees), KYC funnel, active users, service health; date-ranged read aggregations. |

`AppModule` composes them. Each admin command service calls `AuditService.record(...)` explicitly with before/after + `actorAdminId` + `correlationId` + IP.

### 5.3 Keystone mechanisms

**RBAC.** The `Permission` table is the source of truth, **seeded from a canonical catalog defined once in `@handshake-agent/contracts`** (`admin-permissions.ts`) so API guards and web-admin nav agree. Each guarded route declares `@RequirePermission(resourceType, resourceId, action)`; `PermissionGuard` loads `@CurrentAdmin`'s effective permissions (role → `RolePermissionAssignment` → `Permission`) and **default-denies** when none matches. `super_admin` is `isBuiltin` and short-circuits to allow-all. Built-in roles: `super_admin`, `ops`, `compliance`, `finance`, `support`. `/admin/me` returns the admin's effective permissions + granted `menu_item`/`web_page` ids so web-admin can gate nav (UX only).

**Audit.** `currentHash = SHA-256(canonicalJSON({actor, actorUserId, actorAdminId, subject, action, details, before, after, createdAt}) ‖ prevHash)`, deterministic field order; `prevHash` links the previous row's `currentHash` (`'0'` genesis). Appends run inside a **SERIALIZABLE transaction holding a Postgres advisory lock on the chain** so concurrent writes can't fork it. The repository exposes **no update/delete** (immutability — Prisma can't express it; a follow-up SQL migration can add a row-level `REVOKE UPDATE/DELETE` + trigger, noted but not blocking). Audit viewer endpoint with filters (actor/subject/action/date range, paginated) + an on-demand "verify chain" action; daily job re-walks and records an `audit_chain_check`.

**Config.** `EffectiveConfigService` keeps a **synchronously-readable merged snapshot** (so money-path math stays sync/fast): JSON defaults + env overlaid with editable `AppSetting` rows, keyed by `(key, scope, scopeValue)`. Loaded at boot and rebuilt on a Redis `config:invalidate` message (multi-instance safe; Redis already present via BullMQ). It exposes the **same typed `get<K extends keyof AppConfig>(key)` shape** the current consumers use, minimizing call-site churn. `AdminSettingsService.update(key, value, scope, adminId)` → validate against the per-key Zod registry → reject `isEditable=false` → upsert `AppSetting` → audit before→after → invalidate + publish. Reads to the admin UI strip `isSecret` rows. **All 18 `TODO(config-admin)` consumers switch to inject `EffectiveConfigService`**; behavior is identical when no DB override exists (TDD-locked).

### 5.4 Admin auth & lifecycle
- **Login:** email + password (Argon2id verify, timing-safe) → if `mfaEnabled`, require a valid TOTP code (or a one-time recovery code) → issue an admin JWT whose `jti` = `AdminSession.id`; persist `AdminSession` with `tokenHash` = hash(token), `expiresAt`, `ipAddress`/`userAgent`. `AdminSessionGuard` verifies JWT sig + looks up the session by `tokenHash`, rejecting revoked/expired. Absolute expiry (e.g. 8h, config-tunable); logout revokes. No refresh token (admin re-logs in on expiry).
- **MFA:** TOTP (`otplib`) with `mfaSecret` **encrypted at rest** (new env key `ADMIN_MFA_ENC_KEY`, AES-256-GCM); enrollment returns an `otpauth://` URI + QR (`qrcode`); recovery codes hashed (Argon2id), consumed atomically. MFA mandatory for `super_admin`/`compliance`/`finance` (config-tunable).
- **Step-up:** sensitive actions (money-affecting / limit-changing / role grants / denylist) require a fresh re-auth (password or TOTP) recorded as `AdminSession.stepUpCompletedAt` (**additive migration**), enforced by `AdminStepUpGuard` within a TTL (config-tunable, e.g. 5 min), mirroring the user step-up pattern.
- **Invitations:** an admin with `invitations:write` creates an `AdminInvitation` (email + role, single-use hashed token, TTL); invitee accepts → sets password + enrolls MFA → `AdminUser` becomes `active`.
- **Bootstrap:** an idempotent seed creates built-in roles + the full permission catalog. A guarded one-time bootstrap (CLI/seed gated by env `ADMIN_BOOTSTRAP_TOKEN`, only when zero `AdminUser`s exist) mints the first `super_admin` invitation — no plaintext password ever in env.

### 5.5 web-admin app
- Structure mirrors `web/`: `app/` (login, dashboard, one route per surface) → `components/` (`ui` shadcn, `shared`, `<feature>`) → `lib/` (`api` single axios with admin Bearer + `Idempotency-Key` + 401→login; `query` TanStack hooks; `store` admin-auth zustand incl. step-up state; `schemas`) → `types/`. Access token in memory (+ `sessionStorage`, not `localStorage`); re-login on expiry.
- Nav + pages gated by effective permissions from `/admin/me` (UX); API enforces per-route (security). A reusable **step-up modal** (re-enter password/TOTP) wraps sensitive actions. Tokens-only Tailwind v4, four async branches, accessibility (focus traps, `aria-label`, reduced-motion).

## 6. Phasing

Every phase: **contracts → api (domain/application/infrastructure/presentation) → web-admin → tests → gates green** (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm depcruise`). Each phase ends in a coherent Conventional Commit (or a few). TDD throughout (red → green → refactor); ~100% on authz, audit, config resolution, and money-affecting actions.

### Phase 0 — Admin security foundation
- **Deps/wiring:** add `argon2` (allowlist native build in root `pnpm.onlyBuiltDependencies`), `otplib`, `qrcode`; new env keys `ADMIN_MFA_ENC_KEY`, `ADMIN_BOOTSTRAP_TOKEN` (Zod-validated, fail-closed); Prisma migration creating the admin/audit tables + additive `AdminSession.stepUpCompletedAt`; `prisma generate`.
- **contracts:** `admin-permissions.ts` (canonical catalog + built-in-role→permission map), `admin-auth.dto`, `admin-rbac.dto` (roles/permissions/assignments), `admin-invitation.dto`, `admin-user.dto`, `admin-audit.dto`. Subpath export `/admin`.
- **core/audit:** `AuditService` + `AuditLogRepository` (hash chain, advisory-locked append, verify) + chain-check job.
- **modules/admin (AdminAccessModule):** repos; `AdminAuthService`, `AdminMfaService`, `AdminInvitationService`, `AdminUserService`, `RoleService`, `PermissionCatalogService`, `AdminStepUpService`, `AuthorizationService`; Argon2 hasher + TOTP adapter (ports + infra); `AdminSessionGuard`, `PermissionGuard`+`@RequirePermission`, `AdminStepUpGuard`, `@CurrentAdmin`; controllers (auth, me, admin-users, roles, permissions, invitations, sessions); seeders (roles + catalog) + bootstrap. Fold `AdminWalletsController` onto `AdminSessionGuard` + `@RequirePermission`; deprecate `AdminTokenGuard` (keep only for Bull Board until migrated).
- **web-admin:** scaffold + workspace wiring; login (password + TOTP + recovery), accept-invitation, MFA enrollment; admin-auth store + axios; permission-gated layout/nav shell; audit viewer; admin-user CRUD + role/permission management; sessions list/revoke.
- **tests:** ~100% on guards, permission resolution, password/TOTP/lockout, invitation single-use/TTL, audit hash-chain + immutability + concurrency + verify; e2e supertest for the auth + RBAC happy/deny paths.

### Phase 1 — Config, service registry, pricing/economics, catalog, KYC config
- **api:** `EffectiveConfigService` (layered merge + sync snapshot + Redis invalidation); per-key Zod registry; `AdminSettingsService` (CRUD + audit + isEditable/secret); migrate all 18 `TODO(config-admin)` consumers to `EffectiveConfigService`.
- **Surfaces:** settings editor (effective value + which layer it came from + edit w/ live validation + scope global/tier/provider); service/capability enablement flags (`crypto.buy/sell/send/swap`, `ticketing.<vendor>`, per-channel); pricing/economics (buy/sell spread bps, processing fee bps, swap spread, base rates per asset×currency — the **company margin**, hidden from end-users); catalog (assets/fiat currencies/networks/provider asset-id mappings) with the **multi-currency invariant**: every enabled fiat must have tier limits + base rates (enforced/validated on enable); KYC config (tier definitions, per-tier per-currency tx/daily/velocity limits, Travel Rule thresholds).
- **web-admin:** the config/pricing/catalog/KYC pages.
- **tests:** ~100% on layered resolution + override application + per-key validation + isEditable/secret enforcement + multi-currency invariants; assert money-path behavior unchanged with no override.

### Phase 2 — Users & KYC review
- **api (identity, additive engine-brokered methods):** user search/filter; detail (KYC, tier, devices, balances/ledger, transactions, beneficiaries); actions — adjust tier, suspend/reactivate, force PIN reset, manage bound devices / trigger SIM-swap re-verify, close account (each audited; step-up where sensitive). KYC review queue: list `pending_review`; view docs/data; approve/reject with reason → updates `KycProfile` (+ `reviewedByAdminId`) + audit (the mocked `KycProvider` override path).
- **web-admin:** user search + detail + action modals; KYC review queue + decision UI.
- **tests:** ~100% on each state transition + audit + step-up gating.

### Phase 3 — Transactions / ledger / compliance / treasury
- **api:** transactions oversight (list/search all, detail with ledger legs, provider refs, hashes, status timeline); triage stuck `settling`/`failed`; **engine-brokered, audited, idempotent** `adminRefund`/`adminRetry`/`adminMarkFailed` on the engine (never raw ledger edits) + fold reconcile. Ledger viewer (per-account double-entry, balances) + `verifyAccountIntegrity` (balance + sequence monotonicity). Compliance console (ComplianceEvent disposition approve/block/dismiss + reason + audit; SanctionsRecord view; denylist mgmt via `AppSetting compliance.sanctionsDenylist`; AML rule CRUD versioned; Travel Rule records; SAR/STR draft→submit). Treasury (master/custodial balances per network/asset; reconciliation status; withdrawal oversight via `WithdrawalPolicy`; liquidity/exposure alerts — add read service if `TreasuryExposure`/`Alert` schema exists). Beneficiaries (view; cooling-off status + override, audited).
- **web-admin:** the four consoles.
- **tests:** ~100% on every money-affecting admin action (refund/retry/mark-failed, disposition, override), idempotency, the engine-brokered invariant (no raw ledger writes), integrity check.

### Phase 4 — Notifications/templates, WhatsApp, tickets, agent
- Notification templates CRUD (multilingual, channel) + preview + enable/disable channels (`NotificationTemplate`). WhatsApp flow/template config, opt-in lists, webhook health. Ticket vendor registry (`TicketProvider` port) + commission + enablement. Agent model id/params + system-prompt config (**read-only**), enablement, conversation/intent logs viewer.
- **tests** per surface; assert agent surface cannot move money / is read-only over the proposing layer.

### Phase 5 — Dashboards & metrics
- Transaction volumes & success rates, revenue (spread + fees), KYC funnel, active users, per-service health — date-ranged read aggregations (Prisma `groupBy`/SQL) behind an admin read service; charts in web-admin (tokens-only).
- **tests** on aggregation correctness.

## 7. Permission catalog & built-in roles (canonical, in contracts)

Permission ids follow `resourceType:resourceId:action`. The catalog is grouped by `category` (Access, Config, Users, KYC, Transactions, Ledger, Compliance, Treasury, Beneficiaries, Comms, Tickets, Agent, Metrics, Audit). API routes register `api_route` permissions; web-admin pages/menus register `web_page`/`menu_item` permissions. Built-in role → permission mapping (illustrative, finalized in Phase 0):
- **super_admin:** all (short-circuit).
- **ops:** users (read/write minus close), transactions oversight + triage, treasury read, beneficiaries read, config read, metrics read, audit read.
- **compliance:** KYC review write, compliance console write, sanctions/AML/Travel-Rule/denylist write, users read, transactions read, audit read.
- **finance:** pricing/economics write, treasury write, ledger read, metrics read, transactions read, audit read.
- **support:** users read, transactions read, beneficiaries read, KYC read, metrics read.

## 8. Config key registry (Phase 1)

A registry maps each `AppSetting` key → `{ zodSchema, scope, editable, secret, category, uiHint }`, defined in contracts and consumed by `AdminSettingsService` (validation) + web-admin (form rendering). Covers `pricing.*`, `limits.<fiat>.<tier>.*`, `auth.*`, `directive.*`, `buy/sell/swap.*`, `compliance.*`, `beneficiary.*`, `reconciliation.*`, `statement.*`, `media.*`, `catalog.*` (incl. `catalog.capabilities.*`). Safety-critical infra (signing keys, `DATABASE_URL`, `JWT_SECRET`) is **not** in the registry — env-only, never surfaced.

## 9. Env, deps, migrations

- **Deps (api):** `argon2` (native — allowlist), `otplib`, `qrcode`. **Deps (web-admin):** same baseline as `web` (next/react/tailwind/shadcn/tanstack/zustand/axios/zod/react-hook-form) + Vitest/RTL/Playwright.
- **Env (Zod-validated, fail-closed):** `ADMIN_MFA_ENC_KEY` (32-byte hex, AES-256-GCM), `ADMIN_BOOTSTRAP_TOKEN`, `ADMIN_SESSION_TTL_SECONDS` (default), `ADMIN_JWT_SECRET` (separate from user `JWT_SECRET`). `ADMIN_API_TOKEN` retained only for Bull Board until migrated.
- **Migrations:** one creating the admin/audit/compliance tables already in the schema, plus additive `AdminSession.stepUpCompletedAt`. Run `prisma generate` after. (Worktree needs its own `pnpm install` + `.env`.)

## 10. Risks & mitigations
- **18 money-path config sites:** regression risk → TDD asserting identical behavior with no override; sync snapshot preserves perf.
- **Merge conflicts** with in-flight money-path work on `feat/web-agent-vertical`: accepted; keep admin work in mostly-new files; rebase/merge later (fast-moving branch → merge not rebase).
- **Audit-chain concurrency:** serialized advisory-locked append.
- **`argon2` native build** under pnpm 10: allowlist; fallback to Node `scrypt` (PIN-path precedent) if the build is troublesome.
- **Third app** vs CLAUDE.md "two apps": update §2 + monorepo docs + dependency-cruiser + CI.
- **Bootstrap secret handling:** one-time, env-gated, zero-admin precondition; mints an invitation, never a plaintext password.

## 11. Definition of done (per CLAUDE.md §14, per phase)
TDD followed; unit + integration green; ~100% on touched business logic; model-proposes/engine-disposes preserved; agent has no DB (`depcruise` clean); server-side authz + audit on every admin endpoint; no hardcoded config; cross-boundary shapes from contracts; `lint`/`typecheck`/`test`/`depcruise` green; Conventional Commits.
