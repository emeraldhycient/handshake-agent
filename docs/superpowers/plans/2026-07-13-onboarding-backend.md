# Onboarding Redesign — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the backend so a new user reaches the app on email-OTP verification as `tier_1` (buy/receive), sets a PIN before KYC, and is raised to `tier_2` (send/sell/swap) / `tier_3` (higher limits) by a real **Sumsub** identity flow — with the money-moving gate enforced per-capability by tier server-side.

**Architecture:** Clean-arch per root `CLAUDE.md` §4 (`presentation → application → domain`; `infrastructure` implements ports). The tier grant + capability→min-tier gate are the money path (§3.1/§3.3) → strict TDD + api e2e. Sumsub slots in behind the existing `IKycProvider` port (async token + webhook path added) with a config-gated mock for local/e2e. Contracts live once in `packages/contracts` (§8). Tunables live in the layered config (§7).

**Tech Stack:** NestJS 11, Prisma 7 (`api/generated/prisma`), Zod `^3.25.x` + `nestjs-zod`, Jest + `@nestjs/testing` (unit) + testcontainers (e2e), BullMQ (webhooks queue), Sumsub REST (`@sumsub/*` not required server-side — HMAC-signed `fetch`).

## Global Constraints

- No LLM/agent changes; agent keeps no DB access (§3.1/§3.2).
- Every money-moving endpoint re-checks tier/limit/sanctions server-side (§3.3); FE is UX only.
- Identity is anchored to verified email + bound device + PIN + Sumsub — never the phone (§3.4). Phone is dropped from signup.
- PIN is `TransactionPinSchema` (4–6 digits, not all-same, not consecutive) — the single canonical shape; hashed server-side, never logged/persisted plaintext.
- No placeholders / no `TODO` without a ticket ref (§3.6). The Sumsub mock is a real config-gated adapter, not a stub.
- Tunable values → layered config (`configuration.ts` default + `AppSetting` overlay), not hardcoded (§7). Secrets → env, Zod-validated at boot.
- Contracts: one Zod schema per shape in `packages/contracts`, `z.infer` type, parse fixtures test (§8).
- Tier ordering: `unverified`(0) < `tier_1`(1) < `tier_2`(2) < `tier_3`(3).
- Capability→min-tier: `crypto.buy`/`crypto.receive` → `tier_1`; `crypto.sell`/`crypto.send`/`crypto.swap` → `tier_2`.
- Sumsub level→tier map: `SUMSUB_LEVEL_TIER2` → `tier_2` (id+liveness); `SUMSUB_LEVEL_TIER3` → `tier_3` (proof-of-address).

---

## Phase 0 — Contracts

### Task 0.1: Email-only signup + signup-verify + extended `MeResponse`

**Files:**
- Modify: `packages/contracts/src/auth/auth.dto.ts`
- Test: `packages/contracts/src/auth/auth.dto.spec.ts`

**Interfaces:**
- Produces: `SignupRequest = { email }`; `SignupVerifyRequest = { email, otp, deviceFingerprint }`; `SignupVerifyResponse = LoginVerifyResponse`; `MeResponse` gains `emailVerified: boolean`.

- [ ] **Step 1: Write failing tests** — in `auth.dto.spec.ts`:

```ts
import { SignupRequestSchema, SignupVerifyRequestSchema, MeResponseSchema } from "./auth.dto";

it("SignupRequest accepts email only (phone now optional)", () => {
  expect(SignupRequestSchema.safeParse({ email: "a@b.co" }).success).toBe(true);
  // phone remains accepted (optional) so existing callers keep compiling
  expect(SignupRequestSchema.safeParse({ email: "a@b.co", phone: "+2348012345678" }).success).toBe(true);
  expect(SignupRequestSchema.safeParse({ email: "bad" }).success).toBe(false);
});

it("SignupVerifyRequest requires email+otp+deviceFingerprint", () => {
  const ok = { email: "a@b.co", otp: "204815", deviceFingerprint: "device-abc-123" };
  expect(SignupVerifyRequestSchema.safeParse(ok).success).toBe(true);
  expect(SignupVerifyRequestSchema.safeParse({ ...ok, otp: "12" }).success).toBe(false);
  expect(SignupVerifyRequestSchema.safeParse({ ...ok, deviceFingerprint: "short" }).success).toBe(false);
});

it("MeResponse carries emailVerified", () => {
  const me = { userId: crypto.randomUUID(), email: "a@b.co", kycStatus: "not_started", kycTier: "tier_1", hasPin: false, emailVerified: true };
  expect(MeResponseSchema.safeParse(me).success).toBe(true);
});
```

- [ ] **Step 2: Run** `pnpm --filter @handshake-agent/contracts test auth.dto` → FAIL.

- [ ] **Step 3: Edit `auth.dto.ts`** — replace `SignupRequestSchema` (drop `phone`), add verify + emailVerified:

```ts
// Phone made OPTIONAL (not removed) so existing api/web callers keep compiling
// during the migration. The wizard omits it; the backend ignores it; a final
// cleanup task removes the vestigial field once both plans land.
export const SignupRequestSchema = z.object({
  email: z.string().email().max(254),
  phone: z.string().regex(/^\+?[0-9]{8,15}$/, "Enter a valid phone number").optional(),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const SignupVerifyRequestSchema = z.object({
  email: z.string().email().max(254),
  otp: z.string().min(4).max(10),
  deviceFingerprint: z.string().min(8).max(200),
});
export type SignupVerifyRequest = z.infer<typeof SignupVerifyRequestSchema>;

// SignupVerifyResponse === LoginVerifyResponse (session + user projection).
export const SignupVerifyResponseSchema = LoginVerifyResponseSchema;
export type SignupVerifyResponse = z.infer<typeof SignupVerifyResponseSchema>;
```
And add `emailVerified: z.boolean().optional()` to `MeResponseSchema` (place after `hasPin`; optional so the api can adopt it in Task 4.1 without breaking `/auth/me` in the interim — FE treats missing as `false`). **Do NOT** reshape `SignupResponseSchema` — signup's OTP-send step reuses the existing `LoginRequestResponseSchema` (`{ status: "otp_sent", devOtp? }`) in Task 2.2, so no existing consumer breaks here. This task is **purely additive** + one field made optional; scope strictly to `packages/contracts` (only fix contracts-internal fixtures — do not touch `api/` or `web/`).

- [ ] **Step 4: Run** the spec → PASS. Also run the full contracts suite `pnpm --filter @handshake-agent/contracts test` — it must stay green. (Because both new-field changes are optional/additive, no `api`/`web` consumer needs editing here; leave them for their own tasks.)

- [ ] **Step 5: Commit** `feat(contracts): email-only OTP signup + signup-verify + me.emailVerified`.

### Task 0.2: Set-name, Sumsub token, Sumsub webhook payload schemas

**Files:**
- Create: `packages/contracts/src/kyc/kyc-onboarding.dto.ts` (+ export from the `index.ts` barrel; if a new `kyc/` dir, add to the `exports` map per `packages/contracts/CLAUDE.md`)
- Test: `packages/contracts/src/kyc/kyc-onboarding.dto.spec.ts`

**Interfaces:**
- Produces: `SetNameRequest = { firstName, lastName }`; `SumsubTokenRequest = { level: 'tier_2' | 'tier_3' }`; `SumsubTokenResponse = { token, userId }`; `SumsubWebhookPayload` (loose, boundary-validated: `{ type, applicantId, externalUserId, levelName?, reviewResult? }`); `KycTierLevel = z.enum(['tier_2','tier_3'])`.

- [ ] **Step 1: Write failing tests** — valid/invalid fixtures for each schema (level must be `tier_2|tier_3`; names non-empty; webhook requires `type` + `externalUserId`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the schemas. `SumsubWebhookPayloadSchema` mirrors Sumsub's `applicantReviewed` shape:

```ts
export const KycTierLevelSchema = z.enum(["tier_2", "tier_3"]);
export const SetNameRequestSchema = z.object({ firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().min(1).max(80) });
export const SumsubTokenRequestSchema = z.object({ level: KycTierLevelSchema });
export const SumsubTokenResponseSchema = z.object({ token: z.string().min(1), userId: z.string().uuid() });
export const SumsubReviewResultSchema = z.object({
  reviewAnswer: z.enum(["GREEN", "RED"]),
  reviewRejectType: z.enum(["FINAL", "RETRY"]).optional(),
  rejectLabels: z.array(z.string()).optional(),
});
export const SumsubWebhookPayloadSchema = z.object({
  type: z.string(),                       // e.g. "applicantReviewed"
  applicantId: z.string().optional(),
  externalUserId: z.string().min(1),       // === our userId
  levelName: z.string().optional(),
  reviewResult: SumsubReviewResultSchema.optional(),
});
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(contracts): set-name + Sumsub token/webhook schemas`.

---

## Phase 1 — Backend money path: tier grant threading + capability→min-tier gate

### Task 1.1: Thread the granted tier through the KYC repo (kill the hardcoded tier_1)

**Files:**
- Modify: `api/src/modules/identity/infrastructure/kyc.prisma.repository.ts` (the two `TODO(KYC-TIER)` sites: `completeVerificationAtomic`, `completeVerificationForUserAtomic`; the KycProfile upsert)
- Modify: `api/src/modules/identity/application/ports/kyc.repository.port.ts` (add `tier: KycTierValue` to the write inputs)
- Modify: `api/src/modules/identity/application/kyc.service.ts` (pass `result.tier` from `IKycProvider` into the repo write)
- Test: `api/src/modules/identity/application/kyc.service.spec.ts`, `.../infrastructure/kyc.prisma.repository.spec.ts` (if present)

**Interfaces:**
- Consumes: `KycVerifyResult.tier` (already on the port).
- Produces: repo write methods accept `tier: KycTierValue` and persist it to both `User.kycTier` and `KycProfile.tier`.

- [ ] **Step 1: Write failing test** — `kyc.service.spec.ts`: given a provider returning `{ approved: true, tier: 'tier_2' }`, assert the repo write is called with `tier: 'tier_2'` (not `tier_1`).
- [ ] **Step 2: Run** → FAIL (currently hardcoded `tier_1`).
- [ ] **Step 3: Implement** — add `tier` param to the port write signatures; in the repo, replace `kycTier: KycTier.tier_1` / `tier: KycTier.tier_1` with the passed `tier`; in `kyc.service.ts` pass `result.tier`. Keep `tierChangedAt: new Date()`.
- [ ] **Step 4: Run** → PASS. Run the identity unit suite.
- [ ] **Step 5: Commit** `fix(identity): grant the provider-returned KYC tier instead of hardcoding tier_1`.

### Task 1.2: Capability→min-tier config + tier-order helper (domain)

**Files:**
- Modify: `api/src/core/config/configuration.ts` (add a `gating` section)
- Create: `api/src/modules/identity/domain/tier-order.ts` (pure helper)
- Modify: `packages/contracts/src/admin/settings.ts` (register `gating.capabilityMinTier.<cap>` keys so they're admin-tunable — follow the existing `limits.<CODE>.<tier>.<cap>` registry pattern)
- Test: `api/src/modules/identity/domain/tier-order.spec.ts`

**Interfaces:**
- Produces: `TIER_ORDER: Record<KycTierValue, number>`; `tierAtLeast(actual, required): boolean`; `config.gating.capabilityMinTier: Record<string, KycTierValue>`.

- [ ] **Step 1: Write failing test** — `tier-order.spec.ts`:

```ts
import { tierAtLeast } from "./tier-order";
it("orders tiers", () => {
  expect(tierAtLeast("tier_2", "tier_2")).toBe(true);
  expect(tierAtLeast("tier_1", "tier_2")).toBe(false);
  expect(tierAtLeast("tier_3", "tier_2")).toBe(true);
  expect(tierAtLeast("unverified", "tier_1")).toBe(false);
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `tier-order.ts`:

```ts
import type { KycTierValue } from "...";
export const TIER_ORDER: Record<KycTierValue, number> = { unverified: 0, tier_1: 1, tier_2: 2, tier_3: 3 };
export const tierAtLeast = (actual: KycTierValue, required: KycTierValue): boolean =>
  TIER_ORDER[actual] >= TIER_ORDER[required];
```
Add to `configuration.ts` (inside `buildConfig()`), plus the `AppConfig`/interface:

```ts
gating: {
  // Minimum KYC tier required to use each transactable capability. Admin-tunable (§7).
  capabilityMinTier: {
    'crypto.buy': 'tier_1', 'crypto.receive': 'tier_1',
    'crypto.sell': 'tier_2', 'crypto.send': 'tier_2', 'crypto.swap': 'tier_2',
  } as Record<string, KycTierValue>,
},
```
Register the keys in `settings.ts`.

- [ ] **Step 4: Run** → PASS. Confirm boot `validateConfig` still passes (add the `gating` field to any AppConfig fixtures).
- [ ] **Step 5: Commit** `feat(config): capability→min-tier gating map + tier-order helper`.

### Task 1.3: Enforce capability min-tier in `KycGateService`

**Files:**
- Modify: `api/src/modules/identity/application/kyc-gate.service.ts` (`assertBaselineEligibility` + the public `assertCanTransact`/`assertCanReleasePayout` inputs)
- Modify: callers in `api/src/modules/transactions/application/proposal.service.ts` and `execution.service.ts` (pass the `capability` string into the gate for buy/sell/send/swap)
- Test: `api/src/modules/identity/application/kyc-gate.service.spec.ts`

**Interfaces:**
- Consumes: `tierAtLeast`, `config.gating.capabilityMinTier`.
- Produces: gate input gains `capability: 'crypto.buy'|'crypto.sell'|'crypto.send'|'crypto.swap'|'crypto.receive'`; new error `CapabilityTierError(capability, requiredTier, actualTier)` in `domain/gate-errors.ts`.

- [ ] **Step 1: Write failing tests** — matrix in `kyc-gate.service.spec.ts`:

```ts
// tier_1 user
it("tier_1 may buy", () => expect(() => gate.assertCanTransact({ ...tier1, capability: "crypto.buy" })).not.toThrow());
it("tier_1 may NOT send", () => expect(() => gate.assertCanTransact({ ...tier1, capability: "crypto.send" })).toThrow(CapabilityTierError));
it("tier_1 may NOT sell", () => expect(() => gate.assertCanTransact({ ...tier1, capability: "crypto.sell" })).toThrow(CapabilityTierError));
// tier_2 user
it("tier_2 may send/sell/swap", () => { for (const c of ["crypto.send","crypto.sell","crypto.swap"]) expect(() => gate.assertCanTransact({ ...tier2, capability: c })).not.toThrow(); });
// unverified
it("unverified may not buy", () => expect(() => gate.assertCanTransact({ ...unverified, capability: "crypto.buy" })).toThrow());
```
(Build `tier1/tier2/unverified` fixtures with a `User` at that `kycTier`; `kycStatus` need NOT be `verified` for tier_1.)

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — in `assertBaselineEligibility`, REPLACE the `kycStatus !== 'verified'` hard block with a capability-tier check:

```ts
// SIM-swap + positive-amount + cooling-off checks unchanged, run first.
const requiredTier = this.effectiveConfig.gating().capabilityMinTier[capability] ?? "tier_2"; // fail-closed default
if (!tierAtLeast(user.kycTier, requiredTier)) {
  throw new CapabilityTierError(capability, requiredTier, user.kycTier);
}
```
Keep the numeric limit resolution (`getTierLimits(fiat, user.kycTier)`) exactly as-is; `unverified` still has no limit block → the tier check above rejects it before limits are read. Add `CapabilityTierError` to `gate-errors.ts` and map it in the `DomainExceptionFilter` to a 403 with an actionable message ("Verify your identity to unlock sending"). Thread `capability` through `assertCanTransact` from each proposal/execution call site (`crypto.buy` in `createBuyProposal`, etc.).

- [ ] **Step 4: Run** the gate suite + the transactions proposal/execution suites → PASS.
- [ ] **Step 5: Commit** `feat(identity): capability→min-tier gate (tier_1 buy/receive, tier_2 send/sell/swap)`.

---

## Phase 2 — Backend auth: OTP signup → tier_1, name, PIN-before-KYC

### Task 2.1: Email-verify (and signup-verify) grants tier_1

**Files:**
- Modify: `api/src/modules/auth/application/auth.service.ts` (`markEmailVerified` → also set `kycTier=tier_1`, `tierChangedAt`, `status=active`)
- Modify: `api/src/modules/auth/infrastructure/auth-user.prisma.repository.ts` (the `markEmailVerified` write; add a `grantTier1OnVerify` update or fold into one)
- Test: `api/src/modules/auth/application/auth.service.spec.ts`

**Interfaces:**
- Produces: after email verification, `User.kycTier = 'tier_1'`, `emailVerifiedAt` set, `status='active'`. Idempotent (re-verify does not re-stamp `tierChangedAt` if already ≥ tier_1).

- [ ] **Step 1: Write failing test** — verifying a fresh user's email sets `kycTier='tier_1'` (was `unverified`); a user already ≥ tier_1 is left unchanged (no tier downgrade, no cooling-off re-stamp).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — in the repo, when stamping `emailVerifiedAt`, also `kycTier: 'tier_1'` + `tierChangedAt: now` + `status: 'active'`, **guarded** so it only promotes `unverified → tier_1` (never downgrades a tier_2/3 user re-hitting verify).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(auth): email verification grants tier_1`.

### Task 2.2: `POST /auth/signup` (email-only, sends OTP) + `POST /auth/signup/verify`

**Files:**
- Modify: `api/src/modules/auth/presentation/auth.controller.ts` (+ request DTOs via `createZodDto`)
- Modify: `api/src/modules/auth/application/auth.service.ts` (`signup` sends OTP not link; add `signupVerify` reusing the login-OTP verify + session issuance + tier_1 grant)
- Modify: `api/src/modules/auth/infrastructure/auth-user.prisma.repository.ts` (`createSignup` drops the pending-WhatsApp-phone write)
- Test: `auth.service.spec.ts`, `api/test/auth.e2e-spec.ts` (extend)

**Interfaces:**
- Consumes: existing OTP infra (`auth.otp` config, OTP challenge store), session issuance (`SessionService`), device binding.
- Produces: `POST /auth/signup { email } → { status: 'otp_sent', devOtp? }`; `POST /auth/signup/verify { email, otp, deviceFingerprint } → LoginVerifyResponse` (access token + `ha_refresh` cookie + user with `kycTier='tier_1'`).

- [ ] **Step 1: Write failing e2e** — signup(email) → 200 `{status:'otp_sent', devOtp}` (dev echo); signup/verify(otp) → 200 with `user.kycTier==='tier_1'`, `emailVerified===true`, and a `Set-Cookie: ha_refresh`.
- [ ] **Step 2: Run** `pnpm --filter @handshake-agent/api test:e2e auth` → FAIL.
- [ ] **Step 3: Implement** — `signup`: create-or-resume provisional user (email only, no phone), mint+send OTP (reuse the login OTP path), return `{status:'otp_sent', devOtp?}`. `signupVerify`: validate OTP, call `markEmailVerified` (Task 2.1 → tier_1), bind device, issue session, return `LoginVerifyResponse`. Handle already-verified email (return `otp_sent` shape, send a "log in instead" email — no enumeration oracle).
- [ ] **Step 4: Run** → PASS. Confirm existing login e2e still green.
- [ ] **Step 5: Commit** `feat(auth): email-only OTP signup + signup/verify → session + tier_1`.

### Task 2.3: `POST /profile/name` (set name on KycProfile)

**Files:**
- Modify: `api/src/modules/identity/presentation/profile.controller.ts` (+ DTO)
- Modify: `api/src/modules/identity/application/profile.service.ts` (or `profile-settings.service.ts`) + repo upsert
- Test: profile service spec + `api/test/*profile*.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /profile/name { firstName, lastName }` (JWT) → `{ firstName, lastName }`; upserts `KycProfile.firstName/lastName`; idempotent.

- [ ] **Step 1: Write failing test** — posting name for a tier_1 user with no KycProfile creates one with the names; re-post updates them; `/auth/me` then returns them.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the endpoint + service + repo upsert (create KycProfile if absent, status defaults `not_started`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(identity): POST /profile/name to set KYC-profile name`.

### Task 2.4: Relax PIN-set gate to tier_1

**Files:**
- Modify: `api/src/modules/identity/application/pin-setup.service.ts` (change the `kycStatus === 'verified'` gate to `tierAtLeast(user.kycTier, 'tier_1')`)
- Test: `api/src/modules/identity/application/pin-setup.service.spec.ts`

**Interfaces:**
- Produces: `POST /kyc/pin` succeeds for a `tier_1` (email-verified) PIN-less user; still 409 if a PIN exists; still rejects `unverified`.

- [ ] **Step 1: Write failing test** — tier_1 PIN-less user → `setPin` succeeds (`hasPin` true); unverified → `PinSetupNotVerifiedError`; tier_1 with PIN → `PinAlreadySetError`.
- [ ] **Step 2: Run** → FAIL (currently requires `verified`).
- [ ] **Step 3: Implement** — replace the verified check with `if (!user || !tierAtLeast(user.kycTier, 'tier_1')) throw new PinSetupNotVerifiedError()`. Keep weak-PIN rejection (schema) and the `hasPin` 409.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(identity): allow tier_1 users to set a transaction PIN pre-KYC`.

---

## Phase 3 — Sumsub integration (mock-gated; real path reads env you provide)

### Task 3.1: Migration — `sumsubApplicantId` on KycProfile

**Files:**
- Modify: `api/prisma/schema/02-identity.prisma` (add `sumsubApplicantId String? @unique` to `KycProfile`)
- Create: migration via `pnpm --filter @handshake-agent/api exec prisma migrate dev --name add_sumsub_applicant_id`
- Test: (schema-count test if the repo has one — bump it)

- [ ] **Step 1:** Add the field. **Step 2:** Run `migrate dev`. **Step 3:** `prisma generate`. **Step 4:** boot the api to confirm the migration applies. **Step 5: Commit** `feat(identity): add KycProfile.sumsubApplicantId`.

### Task 3.2: Env + config for Sumsub (schema-validated, mock flag)

**Files:**
- Modify: `api/src/core/config/env.schema.ts` (add `SUMSUB_WEBHOOK_SECRET`, `SUMSUB_BASE_URL` (default `https://api.sumsub.com`), `SUMSUB_LEVEL_TIER2`, `SUMSUB_LEVEL_TIER3`, `KYC_MOCK_MODE` (bool, default true in non-prod, **must be false in prod** — fail-closed prod guard like the other mock flags))
- Modify: `api/.env.example` (document all Sumsub keys)
- Modify: `api/src/core/config/configuration.ts` (`sumsub.levelToTier` map: `{ [SUMSUB_LEVEL_TIER2]: 'tier_2', [SUMSUB_LEVEL_TIER3]: 'tier_3' }`, built from env)
- Test: `api/src/core/config/env.schema.spec.ts`

- [ ] **Step 1: Write failing test** — env schema rejects prod with `KYC_MOCK_MODE=true`; accepts dev with the Sumsub keys absent (mock) and present (real).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(config): Sumsub env + level→tier map + KYC_MOCK_MODE prod guard`.

### Task 3.3: `IKycProvider` async session port + `SumsubKycProvider` + mock

**Files:**
- Modify: `api/src/modules/identity/application/ports/kyc-provider.port.ts` (add `createVerificationSession(input: { userId: string; level: KycTierLevel }): Promise<{ token: string; applicantId: string }>`)
- Create: `api/src/modules/identity/infrastructure/sumsub-kyc.provider.ts` (real adapter — HMAC-signed access-token request)
- Modify: `api/src/modules/identity/infrastructure/mock-kyc.provider.ts` (implement `createVerificationSession` → deterministic fake token/applicantId)
- Modify: `api/src/modules/identity/identity.module.ts` (bind `KYC_PROVIDER` by `KYC_MOCK_MODE`: mock vs Sumsub)
- Test: `sumsub-kyc.provider.spec.ts` (HMAC signing shape; mock deterministic)

**Interfaces:**
- Produces: `createVerificationSession` mints a Sumsub WebSDK access token (`POST {SUMSUB_BASE_URL}/resources/accessTokens?userId=<userId>&levelName=<level>`, headers `X-App-Token`, `X-App-Access-Sig` = HMAC-SHA256(secret, ts+method+path+body), `X-App-Access-Ts`). Real signing is unit-tested against a known vector; the mock returns `{ token: 'mock-<userId>-<level>', applicantId: 'mock-app-<userId>' }`.

- [ ] **Step 1: Write failing tests** — signing helper produces the documented header set for a fixed input; mock returns deterministic values; binding resolves to mock when `KYC_MOCK_MODE=true`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the port method, the real adapter (fetch + HMAC), the mock, the module binding. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(identity): Sumsub access-token provider + mock (config-gated)`.

### Task 3.4: `POST /kyc/sumsub/token` endpoint

**Files:**
- Modify: `api/src/modules/identity/presentation/kyc.controller.ts` (+ DTO from `SumsubTokenRequestSchema`)
- Modify: `api/src/modules/identity/application/kyc.service.ts` (`createSumsubSession(userId, level)` — enforce prerequisite: `level==='tier_3'` requires current `kycTier >= 'tier_2'`)
- Test: kyc.service spec + e2e

**Interfaces:**
- Produces: `POST /kyc/sumsub/token { level }` (JWT) → `{ token, userId }`; 409/403 if the prerequisite rung is unmet.

- [ ] **Step 1: Write failing test** — tier_1 user requesting `tier_2` token → 200; requesting `tier_3` → 403 (needs tier_2 first); tier_2 user requesting `tier_3` → 200.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (call `provider.createVerificationSession`, persist `sumsubApplicantId`, set `kycStatus='pending_review'`). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(identity): POST /kyc/sumsub/token with tier prerequisite`.

### Task 3.5: Sumsub webhook → tier grant (pure mapping)

**Files:**
- Create: `api/src/modules/identity/application/sumsub-review.mapper.ts` (pure: payload → `{ userId, grantTier?, status, reason? }`)
- Test: `sumsub-review.mapper.spec.ts`

**Interfaces:**
- Produces: `mapSumsubReview(payload, levelToTier): { userId; status: 'verified'|'rejected'|'pending_review'; grantTier?: KycTierValue; reason?: string }`. GREEN + known level → verified + that tier; RED → rejected + reason; other/unknown → pending_review, no grant.

- [ ] **Step 1: Write failing tests** — GREEN@tier2-level → `{status:'verified', grantTier:'tier_2'}`; GREEN@tier3-level → tier_3; RED FINAL → `{status:'rejected', reason}`; unknown level → pending_review no grant; missing reviewResult → pending_review.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the pure mapper. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(identity): Sumsub review → tier-grant mapper`.

### Task 3.6: `POST /webhooks/sumsub` — verify, persist, handle

**Files:**
- Create: `api/src/modules/webhooks/presentation/sumsub-webhook.controller.ts` (verify `x-payload-digest` HMAC with `SUMSUB_WEBHOOK_SECRET`, persist-first, ACK)
- Create: `api/src/modules/identity/application/sumsub-webhook.handler.ts` (implements `IWebhookHandler` for provider `sumsub`; runs the mapper → grants tier atomically via the KYC repo, stamping `tierChangedAt`, persisting `sumsubApplicantId`/`livenessCheckResult`)
- Modify: `api/src/modules/webhooks/domain/webhook-provider.ts` (add `sumsub`), module wiring
- Test: `sumsub-webhook.controller.spec.ts` (bad signature → 401; good → persisted+ACK), handler spec, `api/test/*sumsub*.e2e-spec.ts`

**Interfaces:**
- Consumes: `mapSumsubReview`, `config.sumsub.levelToTier`, the KYC repo tier-write (Task 1.1).
- Produces: a signed GREEN webhook for a tier_2 level flips the user to `kycStatus='verified'`, `kycTier='tier_2'`; the user can then send (Phase 1 gate).

- [ ] **Step 1: Write failing e2e** — seed a tier_1 user with a PIN; POST a correctly-signed GREEN webhook (tier_2 level); assert `/auth/me` → `kycTier='tier_2'`, `kycStatus='verified'`; a send proposal that previously 403'd now passes the gate. Bad signature → 401, no state change.
- [ ] **Step 2: Run** `pnpm --filter @handshake-agent/api test:e2e sumsub` → FAIL.
- [ ] **Step 3: Implement** the controller (signature verify → `WebhookIngestionService.persist` → ACK), register the handler in the durable queue, wire the atomic tier grant.
- [ ] **Step 4: Run** → PASS. (Redis :6379 must be up.)
- [ ] **Step 5: Commit** `feat(webhooks): Sumsub webhook → verified + tier grant (persist-first)`.

---

## Phase 4 — Backend gating relaxation surface for the FE + full e2e vertical

### Task 4.1: `/auth/me` + `/profile` expose what the wizard/gating need

**Files:**
- Modify: `api/src/modules/auth/application/ports/auth-user.repository.port.ts` + `auth-user.prisma.repository.ts` (`loadMe` returns `emailVerified: emailVerifiedAt !== null`)
- Test: auth e2e assertions

- [ ] Steps: add `emailVerified` to the `MeProjection` + `loadMe` select; e2e asserts the field; commit `feat(auth): expose emailVerified on /auth/me`.

### Task 4.2: Full onboarding e2e vertical (the acceptance test)

**Files:**
- Create: `api/test/onboarding-vertical.e2e-spec.ts`

- [ ] **Step 1: Write the vertical** — signup(email)→devOtp→signup/verify (tier_1, session) → set name → set PIN → **buy proposal passes**, **send proposal 403 (CapabilityTierError)** → POST signed Sumsub GREEN(tier_2) webhook → **send proposal passes** → POST signed GREEN(tier_3) webhook → limits reflect tier_3.
- [ ] **Step 2: Run** → drives Phases 0–3. Fix any integration gaps.
- [ ] **Step 3: Commit** `test(api): onboarding e2e vertical (email→tier_1→Sumsub→tier_2/3)`.

---

## Self-review checklist (run before handoff)

- Spec §2 tier ladder → Tasks 1.1–1.3, 2.1, 3.5–3.6. ✔
- Spec §3.1 auth → Tasks 2.1–2.2. §3.2 name → 2.3. §3.3 PIN → 2.4. §3.4 Sumsub → 3.1–3.6. §3.5 config/env/migration → 3.1–3.2. ✔
- No placeholders: every task has test + impl direction + commit. FE not in this plan (separate plan). ✔
- Type consistency: `KycTierValue`, `KycTierLevel`, `capability` strings, `tierAtLeast`, `mapSumsubReview` used consistently across tasks. ✔
- Money-path invariants (§3.1/§3.3) preserved and strengthened; agent untouched (§3.2). ✔

## Verification gates (per CLAUDE.md §14)

`pnpm --filter @handshake-agent/contracts test` · `pnpm --filter @handshake-agent/api test` · `pnpm --filter @handshake-agent/api test:e2e` (Redis up; never with coverage concurrently) · `pnpm lint && pnpm typecheck` · `pnpm depcruise`.
