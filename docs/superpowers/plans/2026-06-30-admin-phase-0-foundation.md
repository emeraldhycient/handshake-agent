# Admin Dashboard — Phase 0 (Security Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stand up the admin security core — separate admin principal (Argon2id password + TOTP), RBAC (catalog-driven, default-deny), immutable hash-chained audit, and a `web-admin` app shell with login + permission-gated nav + audit/RBAC management — so every later admin surface plugs into a working, enforced foundation.

**Architecture:** A cross-cutting `core/audit` (append-only hash chain) + an expanded `modules/admin` (AdminAccessModule: auth, MFA, invitations, sessions, RBAC guards) on NestJS, with the canonical permission catalog defined once in `@handshake-agent/contracts`. A new `web-admin` Next 16 app consumes the contracts and gates UI by effective permissions. Admins are a wholly separate principal from end users.

**Tech Stack:** NestJS 11, Prisma 7, Postgres, Zod + nestjs-zod, `argon2`, `otplib`, `qrcode`, `jsonwebtoken` (via `@nestjs/jwt` already in repo for users), BullMQ (chain-check job), Next 16 + React 19 + Tailwind v4 + shadcn + TanStack Query + zustand, Jest/testcontainers + Vitest.

## Global Constraints

- Admins are a separate principal: separate table (`AdminUser`), separate JWT secret (`ADMIN_JWT_SECRET`), separate sessions (`AdminSession`), separate app. Never reuse user PIN/JWT/session. (CLAUDE.md §3)
- Default-deny RBAC: every admin route declares `@RequirePermission`; missing/unmatched ⇒ 403. FE gate is UX only. (task brief)
- Every admin mutation writes an immutable `AuditLog` row (who/when/what/before→after/IP). Money-affecting/limit-changing actions require step-up. (NFR-3)
- Secrets never editable/returned in UI; admin edits only `AppSetting`. `isSecret` never returned; `isEditable=false` rejects writes. (CLAUDE.md §7)
- Cross-boundary shapes from `@handshake-agent/contracts` (Zod + `z.infer`). (CLAUDE.md §8)
- DI tokens are `Symbol('NAME')`; ports in `application/ports/`; repos bound `{ provide, useClass }`. `application` never imports `infrastructure`/`@prisma/client`; only `infrastructure` imports the generated client. (CLAUDE.md §4, enforced by depcruise)
- Strict TDD; ~100% on authz, audit, auth. Hardcode nothing tunable. (CLAUDE.md §9, §7)
- LLM model id `claude-opus-4-8`; zod pinned `^3.25.32`. (CLAUDE.md §6, §8)
- pnpm 10 blocks native build scripts ⇒ allowlist `argon2` in root `pnpm.onlyBuiltDependencies`.

---

## File structure (Phase 0)

**contracts** (`packages/contracts/src/`):
- `admin/permissions.ts` — `AdminResourceType`, `AdminPermissionAction`, `PERMISSION_CATALOG` (array of `{resourceType,resourceId,action,category,description}`), `BUILTIN_ROLES` (`{name,description,permissionMatcher}`), `permissionId()` helper, `AdminPermissionSchema`.
- `dto/admin-auth.dto.ts`, `dto/admin-rbac.dto.ts`, `dto/admin-invitation.dto.ts`, `dto/admin-user.dto.ts`, `dto/admin-audit.dto.ts` — request/response schemas + inferred types.
- `index.ts` + `package.json` exports: add `./admin`.

**api** (`api/src/`):
- `core/audit/` — `audit.module.ts` (`@Global`), `application/audit.service.ts`, `application/ports/audit-log.repository.port.ts`, `infrastructure/audit-log.prisma.repository.ts`, `domain/audit-hash.ts`, `infrastructure/audit-chain-check.processor.ts`.
- `core/config/env.schema.ts` — add admin env keys.
- `modules/admin/` (expand):
  - `domain/` — `admin-errors.ts`.
  - `application/ports/` — `admin-user.repository.port.ts`, `admin-session.repository.port.ts`, `role.repository.port.ts`, `permission.repository.port.ts`, `admin-invitation.repository.port.ts`, `password-hasher.port.ts`, `totp.port.ts`.
  - `application/` — `admin-auth.service.ts`, `admin-token.service.ts`, `admin-mfa.service.ts`, `admin-invitation.service.ts`, `admin-user.service.ts`, `role.service.ts`, `permission-catalog.service.ts`, `authorization.service.ts`, `admin-step-up.service.ts`, `admin-bootstrap.service.ts`.
  - `infrastructure/` — prisma repos for each port; `argon2-password.hasher.ts`; `otplib-totp.adapter.ts`; `mfa-secret.cipher.ts`.
  - `presentation/` — `admin-session.guard.ts`, `permission.guard.ts` + `require-permission.decorator.ts`, `admin-step-up.guard.ts`, `current-admin.decorator.ts`; controllers: `admin-auth.controller.ts`, `admin-me.controller.ts`, `admin-users.controller.ts`, `roles.controller.ts`, `permissions.controller.ts`, `admin-invitations.controller.ts`, `admin-sessions.controller.ts`; DTO wrappers under `presentation/dto/`.
  - `admin.module.ts` (expand), `admin-bootstrap.command.ts` (or seed script).
- Modify `admin/presentation/admin-wallets.controller.ts` to use `AdminSessionGuard` + `@RequirePermission`.

**web-admin** (`web-admin/`): Next app scaffold (mirrors `web/`): `app/`, `components/{ui,shared,admin}`, `lib/{api,query,store,schemas}`, `types/`, config files.

---

## Task 1: Workspace deps, env keys, migration

**Files:**
- Modify: root `package.json` (`pnpm.onlyBuiltDependencies` add `argon2`), `api/package.json` (deps)
- Modify: `api/src/core/config/env.schema.ts`, `api/.env.example`
- Create: `api/prisma/migrations/<ts>_admin_foundation/migration.sql` (via `prisma migrate dev`)
- Modify: `api/prisma/schema/03-admin.prisma` (add `AdminSession.stepUpCompletedAt DateTime? @db.Timestamptz`)

**Interfaces produced:** env keys `ADMIN_JWT_SECRET`, `ADMIN_MFA_ENC_KEY` (64-hex/32-byte), `ADMIN_BOOTSTRAP_TOKEN`, `ADMIN_SESSION_TTL_SECONDS` (default 28800), `ADMIN_STEP_UP_TTL_SECONDS` (default 300); all fail-closed (empty ⇒ feature disabled, validated by Zod).

- [ ] **Step 1** Add deps: `pnpm --filter @handshake-agent/api add argon2 otplib qrcode` and `pnpm --filter @handshake-agent/api add -D @types/qrcode`. Add `"argon2"` to root `package.json` `pnpm.onlyBuiltDependencies`. Run `pnpm install`.
- [ ] **Step 2** Add the env keys to `env.schema.ts` (`z.string().optional().default('')` for secrets/token; `z.coerce.number().int().positive().default(28800)`/`.default(300)` for TTLs) with fail-closed comments mirroring the existing `ADMIN_API_TOKEN`/`JWT_SECRET` style. Mirror into `.env.example`. Copy real values into the worktree `api/.env`.
- [ ] **Step 3** Add `stepUpCompletedAt DateTime? @db.Timestamptz` to `AdminSession` in `03-admin.prisma`.
- [ ] **Step 4** Run `pnpm --filter @handshake-agent/api exec prisma migrate dev --name admin_foundation`. Expected: creates the admin/audit/compliance/config tables + the new column, regenerates client.
- [ ] **Step 5** Run `pnpm --filter @handshake-agent/api exec prisma generate`; `pnpm --filter @handshake-agent/api typecheck`. Expected: green.
- [ ] **Step 6** Commit: `chore(admin): deps, env keys, and migration for admin foundation`.

---

## Task 2: Permission catalog + RBAC contracts

**Files:**
- Create: `packages/contracts/src/admin/permissions.ts`, test `packages/contracts/src/admin/permissions.spec.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/package.json` (exports `./admin`)

**Interfaces produced:**
```ts
export const AdminResourceTypeSchema = z.enum(['api_route','web_page','menu_item'])
export const AdminPermissionActionSchema = z.enum(['read','write','delete','execute'])
export interface PermissionCatalogEntry { resourceType: AdminResourceType; resourceId: string; action: AdminPermissionAction; category: string; description: string }
export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[]
export function permissionId(p: {resourceType:string;resourceId:string;action:string}): string // `${resourceType}:${resourceId}:${action}`
export const BUILTIN_ROLE_NAMES = ['super_admin','ops','compliance','finance','support'] as const
export interface BuiltinRoleDef { name: string; description: string; isBuiltin: true; grants: (e: PermissionCatalogEntry) => boolean } // super_admin grants:()=>true
export const BUILTIN_ROLES: readonly BuiltinRoleDef[]
```

- [ ] **Step 1** Write `permissions.spec.ts`: catalog entries are unique by `permissionId`; every entry has non-empty `category`+`description`; `BUILTIN_ROLES` names == `BUILTIN_ROLE_NAMES`; `super_admin.grants` returns true for all catalog entries; each non-super role grants ⊆ catalog and ⊇ its read perms; `permissionId` round-trips.
- [ ] **Step 2** Run `pnpm --filter @handshake-agent/contracts test`. Expected: FAIL (module missing).
- [ ] **Step 3** Implement `permissions.ts`. Seed the **Phase-0 catalog** entries (Access surface): `api_route` perms for each admin route below (METHOD+path), plus `web_page` (`/admin`, `/admin/admins`, `/admin/roles`, `/admin/audit`, `/admin/sessions`) and `menu_item` (`menu.access`, `menu.audit`) perms, category `Access`/`Audit`. Define `BUILTIN_ROLES` with `grants` predicates per the spec §7 mapping. (Later phases append catalog entries.)
- [ ] **Step 4** Add the new DTO files (Task 3) later; for now export `./admin` from index + package exports.
- [ ] **Step 5** Run contracts test. Expected: PASS. Commit: `feat(contracts): admin permission catalog and built-in roles`.

---

## Task 3: Admin DTO contracts

**Files:** Create `packages/contracts/src/dto/admin-auth.dto.ts`, `admin-rbac.dto.ts`, `admin-invitation.dto.ts`, `admin-user.dto.ts`, `admin-audit.dto.ts` + `.spec.ts` each. Modify `index.ts`.

**Interfaces produced (selected):**
```ts
// admin-auth
AdminLoginRequestSchema = z.object({ email: z.string().email(), password: z.string().min(1), totp: z.string().optional(), recoveryCode: z.string().optional() })
AdminLoginResponseSchema = z.object({ accessToken: z.string(), expiresAt: z.string(), admin: AdminMeSchema })
AdminMeSchema = z.object({ id: z.string().uuid(), email: z.string().email(), role: z.object({id:z.string(),name:z.string()}), mfaEnabled: z.boolean(), permissions: z.array(z.string()) /* permissionIds */, menus: z.array(z.string()), pages: z.array(z.string()) })
AdminStepUpRequestSchema = z.object({ password: z.string().optional(), totp: z.string().optional() })
// admin-invitation
AdminInvitationCreateRequestSchema = z.object({ email: z.string().email(), roleId: z.string().uuid(), reason: z.string().optional() })
AdminInvitationAcceptRequestSchema = z.object({ token: z.string().min(1), password: z.string().min(12) })
AdminMfaEnrollResponseSchema = z.object({ otpauthUri: z.string(), qrSvg: z.string(), recoveryCodes: z.array(z.string()) })
AdminMfaVerifyRequestSchema = z.object({ totp: z.string().min(6) })
// admin-rbac
RoleSchema, RoleCreateRequestSchema = z.object({name,description,permissionIds:z.array(z.string())}), RoleUpdateRequestSchema, PermissionSchema, RoleListResponseSchema, PermissionListResponseSchema
// admin-user
AdminUserSchema, AdminUserListResponseSchema (paginated), AdminUserCreateViaInvite (alias invitation), AdminUserUpdateRoleRequestSchema, AdminUserStatusRequestSchema = z.object({ status: z.enum(['active','suspended','offboarded']) })
// admin-audit
AuditLogEntrySchema, AuditLogQuerySchema = z.object({ actorAdminId?, subject?, action?, from?, to?, cursor?, limit? }), AuditLogListResponseSchema, AuditChainVerifyResponseSchema = z.object({ ok: z.boolean(), checked: z.number(), brokenAt: z.string().nullable() })
```

- [ ] **Step 1** For each DTO file, write a `.spec.ts` parsing one valid + one invalid fixture (assert `.safeParse().success`).
- [ ] **Step 2** Run contracts test → FAIL. Implement the schemas. Run → PASS.
- [ ] **Step 3** Commit: `feat(contracts): admin auth/rbac/invitation/user/audit DTOs`.

---

## Task 4: Audit hash + repository (core/audit)

**Files:** Create `api/src/core/audit/domain/audit-hash.ts` (+spec), `application/ports/audit-log.repository.port.ts`, `infrastructure/audit-log.prisma.repository.ts` (+integration spec), `application/audit.service.ts` (+spec), `audit.module.ts`.

**Interfaces produced:**
```ts
// domain/audit-hash.ts
export function computeAuditHash(input: { actor:string; actorUserId:string|null; actorAdminId:string|null; subject:string; action:string; details:unknown; before:unknown; after:unknown; createdAt:string; prevHash:string }): string // sha256 hex over canonical-ordered JSON ‖ prevHash
// port
export const AUDIT_LOG_REPOSITORY = Symbol('AUDIT_LOG_REPOSITORY')
export interface AppendAuditInput { correlationId:string; actor:string; actorUserId?:string|null; actorAdminId?:string|null; subject:string; action:AuditAction; details:Record<string,unknown>; before?:unknown; after?:unknown }
export interface IAuditLogRepository {
  append(input: AppendAuditInput): Promise<{ id:string; currentHash:string; prevHash:string; createdAt:Date }>
  list(query): Promise<{ items: AuditLogRecord[]; nextCursor: string|null }>
  verifyChain(): Promise<{ ok:boolean; checked:number; brokenAt:string|null }>
}
// AuditService
export class AuditService { record(input: AppendAuditInput): Promise<void> }  // thin wrapper; never throws into caller path silently — logs + rethrows config-controlled
```
`AuditAction` is the Prisma enum (re-exported as a Zod enum in contracts `admin-audit`).

- [ ] **Step 1** Write `audit-hash.spec.ts`: deterministic for fixed input; changes when any field changes; `prevHash='0'` genesis differs from non-genesis; canonical ordering (key order in `details` doesn't change hash). Implement with a stable stringify (sorted keys). Verify PASS.
- [ ] **Step 2** Write `audit-log.prisma.repository.spec.ts` (testcontainers Postgres): `append` twice ⇒ second `prevHash === first.currentHash`; genesis `prevHash==='0'`; concurrent `Promise.all` of N appends ⇒ a single valid chain (no fork; `verifyChain().ok===true`); repository exposes no update/delete; `verifyChain` detects a manually corrupted row. Run → FAIL.
- [ ] **Step 3** Implement the repo: `append` runs `prisma.$transaction(async tx => { await tx.$executeRaw\`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})\`; const last = await tx.auditLog.findFirst({orderBy:{createdAt:'desc'}, select:{currentHash:true}}); const prevHash = last?.currentHash ?? '0'; const createdAt = new Date(); const currentHash = computeAuditHash({...}); return tx.auditLog.create({data:{...,prevHash,currentHash,createdAt}}) })`, isolation `Serializable`. `list` cursor-paginated with filters. `verifyChain` re-walks ordered-by-createdAt recomputing hashes. Run → PASS.
- [ ] **Step 4** Implement `AuditService.record` + `audit.module.ts` (`@Global()`, provides `AUDIT_LOG_REPOSITORY`→prisma impl + `AuditService`, exports `AuditService`). Spec: `record` delegates to repo.append with `actor` derived (`admin:<id>`/`user:<id>`/`system`).
- [ ] **Step 5** Register `AuditModule` in `app.module.ts`. Commit: `feat(api): immutable hash-chained audit log core`.

---

## Task 5: Password hasher + TOTP + MFA cipher adapters

**Files:** Create ports `password-hasher.port.ts`, `totp.port.ts`; infra `argon2-password.hasher.ts` (+spec), `otplib-totp.adapter.ts` (+spec), `mfa-secret.cipher.ts` (+spec).

**Interfaces produced:**
```ts
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER')
export interface IPasswordHasher { hash(plain:string):Promise<string>; verify(hash:string, plain:string):Promise<boolean> }
export const TOTP_PROVIDER = Symbol('TOTP_PROVIDER')
export interface ITotpProvider { generateSecret():string; keyUri(email:string, secret:string):string; verify(token:string, secret:string):boolean }
// MfaSecretCipher: AES-256-GCM using ADMIN_MFA_ENC_KEY
export class MfaSecretCipher { encrypt(plain:string):string; decrypt(payload:string):string }
```

- [ ] **Step 1** `argon2-password.hasher.spec.ts`: `verify(await hash('pw'),'pw')===true`; wrong pw false; uses argon2id. Implement via `argon2.hash(plain,{type:argon2.argon2id})` / `argon2.verify`. PASS.
- [ ] **Step 2** `otplib-totp.adapter.spec.ts`: `verify(authenticator.generate(secret), secret)===true`; bad token false; `keyUri` contains issuer `Handshake Admin`. Implement via `otplib` `authenticator`. PASS.
- [ ] **Step 3** `mfa-secret.cipher.spec.ts`: `decrypt(encrypt(s))===s`; ciphertext≠plaintext; tamper ⇒ throws. Implement AES-256-GCM (`crypto.createCipheriv`, random IV, auth tag; key from env, hex-decoded). PASS.
- [ ] **Step 4** Commit: `feat(api): argon2 password, otplib TOTP, and MFA secret cipher`.

---

## Task 6: Admin repositories

**Files:** ports + prisma impls (+integration specs) for AdminUser, AdminSession, Role, Permission, RolePermissionAssignment (folded into role repo), AdminInvitation.

**Interfaces produced (selected):**
```ts
ADMIN_USER_REPOSITORY: { create(invitedFrom):..., findByEmail(email):AdminUserRecord|null, findById(id):..., list(query):paginated, updateStatus(id,status,at):..., updateRole(id,roleId):..., setPasswordAndActivate(id,passwordHash,at):..., enableMfa(id,encSecret,hashedRecoveryCodes):..., consumeRecoveryCode(id,codeHash):boolean, recordLogin(id,at):... }
ADMIN_SESSION_REPOSITORY: { create({adminUserId,tokenHash,expiresAt,ip,userAgent}):AdminSessionRecord, findActiveByTokenHash(hash,now):...|null, revoke(id,at):..., recordStepUp(id,at):..., listForAdmin(adminUserId):..., revokeAllForAdmin(adminUserId,at):... }
ROLE_REPOSITORY: { create({name,description,isBuiltin,permissionIds}):..., findById(id):RoleWithPermissions|null, findByName(name):..., list():..., update(id,{description,permissionIds}):..., assertNotBuiltin(id), countAdmins(roleId):number }
PERMISSION_REPOSITORY: { upsertCatalog(entries):void, list():PermissionRecord[], findIdsByPermissionIds(ids):..., findByRole(roleId):PermissionRecord[] }
ADMIN_INVITATION_REPOSITORY: { create({email,roleId,tokenHash,expiresAt,createdByAdminId,reason}):..., findActiveByTokenHash(hash,now):...|null, markAccepted(id,at):..., countAdmins():number }
```

- [ ] **Step 1** For each repo, write an integration spec (testcontainers) covering create/find/update + the security-relevant query (`findActiveByTokenHash` excludes revoked/expired; `findByEmail` unique; `upsertCatalog` idempotent). Run → FAIL.
- [ ] **Step 2** Implement prisma repos mapping rows→app records (never leak Prisma types). PASS.
- [ ] **Step 3** Commit: `feat(api): admin user/session/role/permission/invitation repositories`.

---

## Task 7: AuthorizationService (effective permissions, default-deny)

**Files:** `application/authorization.service.ts` (+spec).

**Interfaces produced:**
```ts
export class AuthorizationService {
  effectivePermissionIds(roleId:string):Promise<Set<string>>  // super_admin ⇒ all-catalog set
  can(roleId:string, required:{resourceType,resourceId,action}):Promise<boolean>
  meView(roleId:string):Promise<{ permissions:string[]; menus:string[]; pages:string[] }>
}
```

- [ ] **Step 1** Spec: super_admin role ⇒ `can(...)` true for any catalog perm; ops role ⇒ true for granted, **false for ungranted** (default-deny); unknown perm ⇒ false; `meView` splits by resourceType. Run → FAIL.
- [ ] **Step 2** Implement: load role; if `isBuiltin && name==='super_admin'` short-circuit allow-all; else resolve perms via `PERMISSION_REPOSITORY.findByRole`, build `Set<permissionId>`; `can` = set has `permissionId(required)`. PASS. Commit: `feat(api): RBAC authorization service (default-deny)`.

---

## Task 8: Admin token + auth + step-up + MFA services

**Files:** `admin-token.service.ts`, `admin-auth.service.ts`, `admin-mfa.service.ts`, `admin-step-up.service.ts` (+specs). Domain `admin-errors.ts`.

**Interfaces produced:**
```ts
AdminTokenService: { sign(sessionId:string):{token,expiresAt}, verify(token):{ jti:string }, hash(token):string }  // jwt with ADMIN_JWT_SECRET, ttl=ADMIN_SESSION_TTL_SECONDS, jti=sessionId
AdminAuthService: { login(input, ctx:{ip,ua}):AdminLoginResponse, logout(sessionId):void, me(adminId):AdminMe }
AdminMfaService: { enroll(adminId):{otpauthUri,qrSvg,recoveryCodes}, confirmEnroll(adminId,totp):void, verifyForLogin(admin,totp?,recoveryCode?):boolean }
AdminStepUpService: { challenge(adminId,sessionId,input):void /* verifies pw or totp, records stepUpCompletedAt */, assertFresh(sessionId,now):void /* StepUpRequiredError if stale > ADMIN_STEP_UP_TTL */ }
// admin-errors: AdminInvalidCredentialsError, AdminMfaRequiredError, AdminMfaInvalidError, AdminAccountLockedError, AdminInactiveError, AdminStepUpRequiredError, InvitationInvalidError, BuiltinRoleImmutableError, PermissionDeniedError — each readonly code
```

- [ ] **Step 1** `admin-token.service.spec.ts`: sign→verify round-trips jti; expired token rejected; `hash` stable. Implement (reuse `@nestjs/jwt` `JwtService` with `ADMIN_JWT_SECRET`; `hash`=sha256 hex). PASS.
- [ ] **Step 2** `admin-auth.service.spec.ts` (mock ports): login with right pw + no MFA ⇒ token + session created + `recordLogin` + audit `session_create`; wrong pw ⇒ `AdminInvalidCredentialsError` (+ no session); `status!=='active'` ⇒ `AdminInactiveError`; `mfaEnabled` + missing totp ⇒ `AdminMfaRequiredError`; valid totp ⇒ success; timing-safe (dummy verify on unknown email). Implement. PASS.
- [ ] **Step 3** `admin-mfa.service.spec.ts`: enroll returns otpauth+qr+codes and stores **encrypted** secret pending; confirm with valid totp flips `mfaEnabled`; recovery code verifies once then is consumed. Implement (cipher + totp + repo). PASS.
- [ ] **Step 4** `admin-step-up.service.spec.ts`: challenge with valid pw records `stepUpCompletedAt`; `assertFresh` passes within TTL, throws `AdminStepUpRequiredError` after. Implement. PASS.
- [ ] **Step 5** Commit: `feat(api): admin auth, token, MFA, and step-up services`.

---

## Task 9: Guards + decorators

**Files:** `presentation/admin-session.guard.ts`, `permission.guard.ts`, `require-permission.decorator.ts`, `admin-step-up.guard.ts`, `current-admin.decorator.ts` (+specs).

**Interfaces produced:**
```ts
@RequirePermission(resourceType, resourceId, action)  // SetMetadata('admin_permission', {...})
AdminSessionGuard: validates Bearer ADMIN jwt → session active by tokenHash → sets req.admin = { adminId, sessionId, roleId, email }
PermissionGuard: reads @RequirePermission metadata → AuthorizationService.can(req.admin.roleId, meta) → 403 PermissionDeniedError if false or metadata missing (default-deny)
AdminStepUpGuard: AdminStepUpService.assertFresh(req.admin.sessionId)
@CurrentAdmin(): AdminContext from req.admin
```

- [ ] **Step 1** Specs: `AdminSessionGuard` rejects missing/invalid/expired/revoked; sets `req.admin`. `PermissionGuard` allows when `can` true, 403 when false, **403 when no metadata** (fail-closed). `AdminStepUpGuard` 403 when stale. Run → FAIL.
- [ ] **Step 2** Implement (mirror `JwtAuthGuard` pattern but admin token/session + role). PASS. Commit: `feat(api): admin session, permission (default-deny), and step-up guards`.

---

## Task 10: Catalog/role/invitation/user services + bootstrap

**Files:** `permission-catalog.service.ts`, `role.service.ts`, `admin-invitation.service.ts`, `admin-user.service.ts`, `admin-bootstrap.service.ts` (+specs); `admin-bootstrap.command.ts` (nestjs-commander or a `main`-guarded seed).

**Interfaces produced:**
```ts
PermissionCatalogService: { syncCatalog():Promise<void> /* upsert PERMISSION_CATALOG */, list():Promise<PermissionRecord[]> }
RoleService: { seedBuiltins():Promise<void> /* idempotent: create roles + assignments from BUILTIN_ROLES */, list, create(input, actor), update(id,input, actor) /* assertNotBuiltin */, ... each audited }
AdminInvitationService: { create(input, actorAdminId, ctx):{invitationToken} /* audited */, accept({token,password}):{adminId} /* sets pw, status active, audited */ }
AdminUserService: { list(query), get(id), updateRole(id,roleId,actor), setStatus(id,status,actor) /* offboarded ⇒ revoke all sessions */ }
AdminBootstrapService: { bootstrap(token:string):{invitationToken} /* requires token===ADMIN_BOOTSTRAP_TOKEN && countAdmins()===0; seeds catalog+roles; creates super_admin invitation */ }
```

- [ ] **Step 1** Specs: `syncCatalog` idempotent; `seedBuiltins` idempotent + creates 5 roles with correct perm counts; role create/update audited + builtin immutable; invitation create→accept single-use + audited; `setStatus('offboarded')` revokes sessions + audited; `bootstrap` rejects wrong token / when admins exist, else mints invitation. Run → FAIL. Implement. PASS.
- [ ] **Step 2** Commit: `feat(api): permission catalog, role, invitation, user, and bootstrap services`.

---

## Task 11: Controllers + module wiring + fold existing admin

**Files:** controllers (auth, me, admin-users, roles, permissions, invitations, sessions) + DTO wrappers; expand `admin.module.ts`; modify `admin-wallets.controller.ts`; register module(s) in `app.module.ts`. e2e spec `api/test/admin-rbac.e2e-spec.ts`.

**Routes (each `@RequirePermission` except auth/bootstrap/accept):** `POST /admin/auth/login`, `POST /admin/auth/logout`, `GET /admin/me`, `POST /admin/auth/step-up`, `POST /admin/auth/mfa/enroll`, `POST /admin/auth/mfa/confirm`, `POST /admin/bootstrap`, `POST /admin/invitations`, `POST /admin/invitations/accept`, `GET /admin/admins`, `GET /admin/admins/:id`, `PATCH /admin/admins/:id/role`, `PATCH /admin/admins/:id/status`, `GET /admin/roles`, `POST /admin/roles`, `PATCH /admin/roles/:id`, `GET /admin/permissions`, `GET /admin/audit`, `POST /admin/audit/verify`, `GET /admin/sessions`, `DELETE /admin/sessions/:id`.

- [ ] **Step 1** Wrap each request schema with `createZodDto`; build controllers calling services, parsing responses through the contract schema; apply `@UseGuards(AdminSessionGuard, PermissionGuard)` (+ `AdminStepUpGuard` on role-grant/status/offboard) and `@RequirePermission(...)` matching the catalog entries; `@CurrentAdmin()` for actor; throttle login/bootstrap/accept.
- [ ] **Step 2** Map admin domain errors → HTTP in a small exception filter or the existing global filter (401 invalid creds / 403 permission+step-up / 409 builtin-immutable / 410 invitation). Spec the mapping.
- [ ] **Step 3** Fold `AdminWalletsController`: replace `@UseGuards(AdminTokenGuard)` with `@UseGuards(AdminSessionGuard, PermissionGuard)` + `@RequirePermission('api_route','POST /admin/wallets/reconcile','execute')` etc. Add those entries to the Phase-0 catalog (category `Treasury`). Keep Bull Board on `AdminTokenGuard` for now (note).
- [ ] **Step 4** Expand `admin.module.ts` (provide all ports→impls, services, guards; import `AuthModule`/`JwtModule` for admin token; import `WalletsModule`/`IdentityModule` as today). On bootstrap, run `syncCatalog` + `seedBuiltins` via `OnModuleInit` (idempotent).
- [ ] **Step 5** e2e (`admin-rbac.e2e-spec.ts`, testcontainers + supertest): bootstrap → accept invite → login → `GET /admin/me` shows super_admin perms → create `support` admin via invite → login as support → `GET /admin/admins` allowed but `POST /admin/roles` ⇒ 403 → audit log has the create/login rows → `POST /admin/audit/verify` ok. Run → green.
- [ ] **Step 6** Commit: `feat(api): admin RBAC controllers, module wiring, fold legacy admin guard`.

---

## Task 12: web-admin scaffold + workspace wiring

**Files:** new `web-admin/` (package.json, next.config.ts, tsconfig.json, app/globals.css, eslint, `.dependency-cruiser.cjs`, `.env.example`); modify root `pnpm-workspace.yaml`, `turbo.json`, root `tsconfig`, CI workflow, CLAUDE.md §2.

- [ ] **Step 1** Scaffold mirroring `web/` config: Next 16 + Tailwind v4 (copy `globals.css` token setup), `transpilePackages:['@handshake-agent/contracts']`, contracts tsconfig alias, `outputFileTracingRoot`. Add `@handshake-agent/web-admin` to `pnpm-workspace.yaml` globs and `turbo.json` is task-graph driven (no change needed beyond glob). Add deps (next/react/tailwind/shadcn/tanstack/zustand/axios/zod/react-hook-form + Vitest/RTL). Add `test`+`typecheck`+`lint` scripts.
- [ ] **Step 2** `pnpm install`; `pnpm --filter @handshake-agent/web-admin typecheck`; a smoke Vitest test renders a trivial component. Green.
- [ ] **Step 3** Update CLAUDE.md §2 ("two apps" → three; add `web-admin/`) + `docs/monorepo.md` note. Commit: `feat(web-admin): scaffold admin app + workspace wiring`.

---

## Task 13: web-admin auth (login/TOTP/accept-invite/MFA) + store + axios

**Files:** `lib/api/client.ts` (admin axios), `lib/api/admin-auth.ts`, `lib/store/admin-auth-store.ts`, `lib/query/keys.ts`+`hooks.ts`, `app/login/page.tsx`, `app/accept-invite/page.tsx`, `components/admin/login-form.tsx`, `components/admin/mfa-*` (+Vitest specs).

- [ ] **Step 1** Admin axios: Bearer from `adminAuthStore` (sessionStorage), `Idempotency-Key` on mutations, 401⇒clear+redirect `/login` (no user-style refresh). Parse all bodies through contract schemas.
- [ ] **Step 2** Login form (email/password/optional TOTP/recovery), accept-invite (set password), MFA enroll (show QR + recovery codes). 4 async branches. Specs with RTL: submit calls client with parsed body; error branch renders message.
- [ ] **Step 3** Commit: `feat(web-admin): admin login, accept-invite, MFA, auth store`.

---

## Task 14: web-admin shell (permission-gated nav) + audit/RBAC pages

**Files:** `app/layout.tsx`+providers, `components/admin/app-shell.tsx` (nav gated by `/admin/me` menus), `components/admin/require-permission.tsx`, route pages `app/(admin)/admins`, `/roles`, `/audit`, `/sessions`, `/page.tsx` (dashboard stub) + feature components + hooks (+specs).

- [ ] **Step 1** `useAdminMe()` query; `AppShell` renders nav items only for granted `menu_item`s; `RequirePermission` wrapper hides/blocks pages lacking the `web_page` perm (UX). Each page: TanStack hook + 4 branches.
- [ ] **Step 2** Pages: admins list + invite + role/status actions (step-up modal on status/role); roles list + create/edit permission matrix; audit viewer (filters + verify-chain button + chain status); sessions list + revoke. RTL specs for the gating (support role sees fewer nav items; permission-less page blocked) and the step-up modal flow.
- [ ] **Step 3** Commit: `feat(web-admin): permission-gated shell, admin/role/audit/session management`.

---

## Task 15: Phase-0 gate + integration sweep

- [ ] **Step 1** Run `pnpm lint && pnpm typecheck && pnpm test && pnpm depcruise` (root, fans out incl. web-admin). Fix until green. Verify depcruise: agent has no DB; `application` doesn't import `infrastructure`; web-admin layering clean.
- [ ] **Step 2** Manual/e2e smoke: boot api + web-admin, run bootstrap→login→nav gating→audit verify (Playwright optional). 
- [ ] **Step 3** Final Phase-0 commit / ensure all green; update memory + the project's running notes.

---

## Self-review notes
- **Spec coverage:** Phase-0 items in spec §6 (audit core, admin auth+MFA+invitations+sessions, RBAC catalog+guards+built-in roles, bootstrap, fold legacy guard, web-admin scaffold+login+shell+audit/RBAC mgmt) each map to Tasks 2–14. Config/users/txn/compliance/etc. are later-phase plans (deferred by design).
- **Default-deny** is tested in Tasks 7, 9, 11. **Immutability + concurrency** in Task 4. **Secrets** (MFA secret encrypted, never returned) in Tasks 5, 8.
- **Type consistency:** `permissionId()`, `AdminMe.permissions/menus/pages`, `req.admin.{adminId,sessionId,roleId}`, `AUDIT_LOG_REPOSITORY.append` used consistently across tasks.
- **Later phases:** separate plans `2026-..-admin-phase-1-config.md` … written when reached.
