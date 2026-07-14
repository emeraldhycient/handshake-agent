# Retire the legacy synchronous NIN/BVN KYC path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the two dead synchronous-KYC endpoints (`POST /kyc/submit`, `POST /kyc/complete`) and everything only they used — `IKycProvider.verify()`, the KYC-repo `complete*Atomic` writes, the WhatsApp handoff-token code — so `KYC_MOCK_MODE=false` (real Sumsub) can never 500, and migrate the e2e suites off `/kyc/submit`.

**Architecture:** Backend-only, clean-arch per root `CLAUDE.md` §4 (`presentation → application → domain`; `infrastructure` implements ports). Purely subtractive except two small additions: the WhatsApp handoff sends a plain onboarding link, and a shared e2e helper mints verified users via the new email-OTP + Sumsub-webhook path. The `HandoffToken` Prisma model is kept **dormant** (no migration). See the design spec: [`2026-07-13-retire-legacy-sync-kyc-endpoints-design.md`](../specs/2026-07-13-retire-legacy-sync-kyc-endpoints-design.md).

**Tech Stack:** NestJS 11, Prisma 7 (`api/generated/prisma`), Zod `^3.25.x` + `nestjs-zod`, Jest + `@nestjs/testing` (unit) + `@testcontainers/postgresql` (e2e), supertest.

## Global Constraints

- **Scope is backend only.** Do **not** touch `web/` or `packages/contracts`. The FE `/onboarding` + `/kyc` pages, `KycForm`/`OnboardingKycForm`, `web/lib/api/kyc.ts`, and the contract schemas in `packages/contracts/src/dto/kyc-complete.dto.ts` are owned by the frontend plan and removed there.
- **Merge gate:** this branch's removal must merge **after** the FE cutover has stopped calling `/kyc/submit` + `/kyc/complete` (FE-first, or concurrent). Because contracts are untouched here, FE keeps compiling regardless of merge order.
- **Keep dormant, do not migrate:** the `HandoffToken` model + `HandoffPurpose`/`HandoffTokenStatus` enums + `User.handoffTokens` / `Conversation.handoffTokens` back-relations + `ReplyRow.handoffTokenId` column stay in `api/prisma/schema/`. **No Prisma migration is created.** (The prisma-schema model/enum count test therefore needs no bump.)
- **Preserve every Sumsub path:** `createVerificationSession`, `POST /kyc/sumsub/token`, `POST /webhooks/sumsub`, `grantSumsubTier`/`markSumsubRejected`/`markSumsubPendingReview`/`downgradeSumsubTier`/`setSumsubApplicantId`, `SumsubPrerequisiteNotMetError`, `KycService.createSumsubSession`. Keep `POST /kyc/pin` (`KycController.setPin`) and `PinSetupService`.
- **TDD (§9), frequent commits.** Conventional Commits, scope from `[api, web, web-admin, contracts, agent, admin, config, ci, deps, repo, docs]` — use `api`. One coherent change per commit.
- **e2e runs locally only** (`pnpm --filter @handshake-agent/api test:e2e`): needs Docker Postgres + Redis on `:6379`; **never run api coverage + e2e concurrently** (false timeouts). Unit config is the inline `jest` block in `api/package.json`.
- **`dev` vs `start:dev`:** if you boot the API, `start:dev` watches; `dev` does not. Neither is needed for this plan (it's tests + tsc).

---

## Pre-flight (Task 0)

### Task 0: Re-sync + confirm blast radius

**Files:** none (verification only).

- [ ] **Step 1: Re-sync the worktree to the live branch tip.** `feat/onboarding-redesign` moves; you may be behind.

Run:
```bash
cd /Users/dev_mechanic/Desktop/dev-projects/handshake-agent/.claude/worktrees/reverent-cannon-7de4f2
git fetch --all --quiet 2>/dev/null; git status --porcelain    # expect clean
git log --oneline -1                                           # note current tip
```
If `feat/onboarding-redesign` (checked out in the primary repo dir) is ahead of your HEAD and your tree is clean, re-sync: `git reset --hard feat/onboarding-redesign`. (If it is NOT ahead, skip.) Then re-run `prisma generate` if any schema changed since your last generate: `pnpm --filter @handshake-agent/api exec prisma generate`.

- [ ] **Step 2: Confirm the removal set has exactly the callers this plan assumes.** These greps gate the deletions in Tasks 5–7.

Run:
```bash
cd /Users/dev_mechanic/Desktop/dev-projects/handshake-agent/.claude/worktrees/reverent-cannon-7de4f2
grep -rn "\.verify(" api/src/modules/identity --include="*.ts" | grep -v "\.spec\.\|\.e2e" | grep "kycProvider"     # expect ONLY the 2 kyc.service.ts calls
grep -rn "completeVerificationAtomic\|completeVerificationForUserAtomic" api/src --include="*.ts" | grep -v "\.spec\." # expect port + prisma impl + kyc.service only
grep -rn "mintKycToken\|consumeKycToken\|HandoffTokenService\|HandoffTokenDomainError\|HANDOFF_TOKEN_REPOSITORY" api/src --include="*.ts" | grep -v "\.spec\." # expect only files this plan deletes/edits
grep -rn "ContactNotFoundError\|KycRejectedError\|KYC_REJECTED_USER_MESSAGE" api/src --include="*.ts" | grep -v "\.spec\." # expect only kyc.service.ts + kyc.controller.ts + kyc-errors.ts
```
Expected: no consumers outside the files named in Tasks 5–7. If a grep surfaces an unexpected consumer, STOP and reconcile before deleting (the design's §9 open items).

- [ ] **Step 3: Baseline green.** Establish that unit + typecheck + depcruise are clean before you change anything.

Run:
```bash
pnpm --filter @handshake-agent/api typecheck
pnpm --filter @handshake-agent/api test
pnpm depcruise
```
Expected: PASS (note any pre-existing known-red so you can distinguish your effects).

- [ ] **Step 4: Commit** — nothing to commit (verification only). Proceed.

---

## Phase A — e2e migration (must precede endpoint removal)

The setup suites call `/kyc/submit` in `beforeAll` only to mint a verified user. Migrate them to the new email-OTP path **before** deleting the endpoint, so every step stays green (in e2e, `KYC_MOCK_MODE=true`, so `/kyc/submit` still works until Task 5 removes it).

### Task 1: Shared `mint-verified-user` e2e helper

**Files:**
- Create: `api/test/helpers/mint-verified-user.ts`
- Reference (do not modify): `api/test/helpers/drain-webhooks.ts`, `api/test/onboarding-vertical.e2e-spec.ts`

**Interfaces:**
- Consumes: `POST /auth/signup/request {email}` → `{status:'otp_sent', devOtp}`; `POST /auth/signup/verify {email, otp, deviceFingerprint}` → `{accessToken, refreshToken, user: MeResponse}` where `user.userId` is the uuid; `POST /kyc/pin {pin}` (Bearer) → `200`; `POST /webhooks/sumsub` (signed) + `drainWebhooks(app)`.
- Produces:
  - `mintTier1User(app, opts?: { email?: string; pin?: string }): Promise<MintedUser>` where `MintedUser = { accessToken: string; userId: string; email: string; deviceFingerprint: string }`
  - `grantTierViaSumsubWebhook(app, params: { userId: string; levelName: string; secret: string; applicantId?: string }): Promise<void>`

- [ ] **Step 1: Write the helper.** (No separate failing test — the helper is exercised by every migrated suite in Tasks 2–3, which are the tests; a helper-only unit test would duplicate them.)

```ts
/**
 * Shared e2e helper: mint a verified user via the NEW onboarding path
 * (email-OTP → tier_1 [+ optional PIN]; optional signed Sumsub webhook → tier_2/3).
 * Replaces the legacy `signup → verify-email → login → kyc/submit` setup that the
 * retired /kyc/submit endpoint served. Mirrors onboarding-vertical.e2e-spec.ts.
 */
import { createHmac } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { drainWebhooks } from './drain-webhooks';

export interface MintedUser {
  accessToken: string;
  userId: string;
  email: string;
  deviceFingerprint: string;
}

/**
 * Email-OTP signup → active tier_1 session. Sets a PIN too when `opts.pin` is
 * given (via POST /kyc/pin — allowed for tier_1 users). Requires the suite's
 * env to have `AUTH_DEV_EXPOSE_OTP=true` (the devOtp echo).
 */
export async function mintTier1User(
  app: INestApplication,
  opts: { email?: string; pin?: string } = {},
): Promise<MintedUser> {
  const email =
    opts.email ?? `e2e_${Date.now()}_${Math.floor(Math.random() * 1e6)}@test.com`;
  const deviceFingerprint = `e2e-fp-${email.slice(0, 24)}`;

  const sr = await request(app.getHttpServer())
    .post('/auth/signup/request')
    .send({ email })
    .expect(200);
  const { devOtp } = sr.body as { status: string; devOtp: string };

  const sv = await request(app.getHttpServer())
    .post('/auth/signup/verify')
    .send({ email, otp: devOtp, deviceFingerprint })
    .expect(200);
  const svBody = sv.body as { accessToken: string; user: { userId: string } };
  const accessToken = svBody.accessToken;
  const userId = svBody.user.userId;

  if (opts.pin) {
    await request(app.getHttpServer())
      .post('/kyc/pin')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ pin: opts.pin })
      .expect(200);
  }

  return { accessToken, userId, email, deviceFingerprint };
}

/**
 * Posts a signed GREEN Sumsub `applicantReviewed` webhook for `levelName` and
 * drains the durable queue, so the mapped tier (tier_2/tier_3) is granted +
 * kycStatus becomes 'verified'. The suite must set SUMSUB_WEBHOOK_SECRET and the
 * SUMSUB_LEVEL_TIER2/3 env matching `levelName` in its beforeAll.
 */
export async function grantTierViaSumsubWebhook(
  app: INestApplication,
  params: { userId: string; levelName: string; secret: string; applicantId?: string },
): Promise<void> {
  const payload = {
    type: 'applicantReviewed',
    applicantId: params.applicantId ?? `mock-app-${params.userId}`,
    externalUserId: params.userId,
    levelName: params.levelName,
    reviewResult: { reviewAnswer: 'GREEN' },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac('sha256', params.secret).update(rawBody).digest('hex');

  await request(app.getHttpServer())
    .post('/webhooks/sumsub')
    .set('Content-Type', 'application/json')
    .set('x-payload-digest', signature)
    .set('x-payload-digest-alg', 'HMAC_SHA256_HEX')
    .send(payload)
    .expect(200);

  await drainWebhooks(app);
}
```

- [ ] **Step 2: Typecheck the helper compiles** (it has no test of its own yet).

Run: `pnpm --filter @handshake-agent/api typecheck`
Expected: PASS (the file is picked up by the e2e tsconfig; `supertest` default import matches existing suites — if the repo uses `import request from 'supertest'` elsewhere, match that; if it uses `import * as request`, switch to that form).

- [ ] **Step 3: Commit**

```bash
git add api/test/helpers/mint-verified-user.ts
git commit -m "test(api): add mint-verified-user e2e helper (email-OTP + Sumsub-webhook path)"
```

### Task 2: Migrate the tier_1 setup suites

**Files (Modify — the `beforeAll`/setup helper of each):**
- `api/test/web-buy.e2e-spec.ts`
- `api/test/web-balance.e2e-spec.ts`
- `api/test/wallet-reads.e2e-spec.ts`
- `api/test/transaction-list.e2e-spec.ts`
- `api/test/transaction-history.e2e-spec.ts`
- `api/test/web-chat.e2e-spec.ts`
- `api/test/web-voice.e2e-spec.ts`
- `api/test/kyc-wallet-provision.e2e-spec.ts`
- `api/test/profile.e2e-spec.ts`

**Interfaces:**
- Consumes: `mintTier1User` from Task 1.

These suites need a verified user with a PIN for **buy/receive/read** flows, which now require only `tier_1` (the branch's capability→min-tier gate — commit `7b04f93`). Replace the legacy setup with `mintTier1User(app, { pin })`. **Read each suite's `beforeAll` first** — they differ in variable names, PIN value, and what they return.

- [ ] **Step 1: Worked example — `web-buy.e2e-spec.ts`.** The current setup (around lines 270–300) is:

```ts
    // 3. Login request / 4. Login verify / 5. KYC submit (sets PIN)
    // ...login/request → login/verify → POST /kyc/submit {firstName,lastName,nin,pin} → { userId }
    return { accessToken, userId };
```

Replace the whole `signup → verify-email → login → kyc/submit` block (keep the surrounding container/app boot) with:

```ts
    const { accessToken, userId } = await mintTier1User(app, { pin });
    return { accessToken, userId };
```

Add the import at the top: `import { mintTier1User } from './helpers/mint-verified-user';`. Ensure the suite's env block has `AUTH_DEV_EXPOSE_OTP: 'true'` (most already do for login OTP; add if missing). Remove now-unused legacy setup vars (e.g. `nin`, `firstName`, `lastName`) if nothing else references them.

- [ ] **Step 2: Run `web-buy` to confirm green on the new path.**

Run: `pnpm --filter @handshake-agent/api test:e2e -- web-buy`
Expected: PASS (same assertions; the user reaches tier_1 + PIN and buys). If a buy assertion depended on `kycStatus==='verified'` rather than `kycTier`, adjust the assertion to `kycTier==='tier_1'` (the gate is tier-based now).

- [ ] **Step 3: Apply the same replacement to the other eight suites in the list.** For each: read its `beforeAll`, swap the legacy mint for `mintTier1User(app, { pin })`, add the import, fix unused vars.

- [ ] **Step 4: Run the migrated tier_1 suites.**

Run: `pnpm --filter @handshake-agent/api test:e2e -- web-balance wallet-reads transaction-list transaction-history web-chat web-voice kyc-wallet-provision profile`
Expected: PASS. (Run in batches if your machine is memory-constrained; each boots its own Postgres container.)

- [ ] **Step 5: Commit**

```bash
git add api/test/web-buy.e2e-spec.ts api/test/web-balance.e2e-spec.ts api/test/wallet-reads.e2e-spec.ts api/test/transaction-list.e2e-spec.ts api/test/transaction-history.e2e-spec.ts api/test/web-chat.e2e-spec.ts api/test/web-voice.e2e-spec.ts api/test/kyc-wallet-provision.e2e-spec.ts api/test/profile.e2e-spec.ts
git commit -m "test(api): migrate tier_1 e2e setup off /kyc/submit to mint-verified-user helper"
```

### Task 3: Migrate the tier_2 + Sumsub setup suites

**Files (Modify):**
- `api/test/web-sell-send.e2e-spec.ts` (needs `tier_2` — send/sell)
- `api/test/kyc-sumsub-token.e2e-spec.ts` (seeds tier_1 then exercises Sumsub token)
- `api/test/sumsub-webhook.e2e-spec.ts` (seeds tier_1 then posts webhooks)

**Interfaces:**
- Consumes: `mintTier1User`, `grantTierViaSumsubWebhook` from Task 1.

- [ ] **Step 1: Ensure Sumsub env in each suite's `beforeAll`.** Add (if absent) to the `Object.assign(process.env, {...})` block, mirroring `onboarding-vertical.e2e-spec.ts`:

```ts
      SUMSUB_WEBHOOK_SECRET: 'e2e-sumsub-webhook-secret',
      SUMSUB_LEVEL_TIER2: 'id-and-liveness',
      SUMSUB_LEVEL_TIER3: 'full-kyc',
```
(`kyc-sumsub-token` / `sumsub-webhook` already set these — reuse their existing constants rather than duplicating.)

- [ ] **Step 2: `web-sell-send` — mint a tier_2 user.** Replace the legacy `/kyc/submit` setup with:

```ts
    const { accessToken, userId } = await mintTier1User(app, { pin });
    await grantTierViaSumsubWebhook(app, {
      userId,
      levelName: 'id-and-liveness',              // === SUMSUB_LEVEL_TIER2 set above
      secret: 'e2e-sumsub-webhook-secret',        // === SUMSUB_WEBHOOK_SECRET set above
    });
    return { accessToken, userId };
```
Add the import `import { mintTier1User, grantTierViaSumsubWebhook } from './helpers/mint-verified-user';`.

- [ ] **Step 3: `kyc-sumsub-token` / `sumsub-webhook` — replace their tier_1 seeding** (the `/kyc/submit` call) with `mintTier1User(app, { pin })`, keeping the rest of each suite (they then test the Sumsub token / webhook behavior directly).

- [ ] **Step 4: Run the three suites.**

Run: `pnpm --filter @handshake-agent/api test:e2e -- web-sell-send kyc-sumsub-token sumsub-webhook`
Expected: PASS. (`web-sell-send` now reaches tier_2 and send/sell pass; if a velocity assertion is pre-existing-red per repo notes, confirm it's unrelated.)

- [ ] **Step 5: Commit**

```bash
git add api/test/web-sell-send.e2e-spec.ts api/test/kyc-sumsub-token.e2e-spec.ts api/test/sumsub-webhook.e2e-spec.ts
git commit -m "test(api): migrate tier_2/Sumsub e2e setup off /kyc/submit to mint-verified-user helper"
```

### Task 4: Delete the endpoint-specific e2e suites

**Files (Delete):**
- `api/test/kyc-submit.e2e-spec.ts`
- `api/test/kyc-complete.e2e-spec.ts`

- [ ] **Step 1: Confirm no other file imports from them** (they're standalone suites): `grep -rn "kyc-submit\|kyc-complete" api/test | grep -v "kyc-submit.e2e-spec.ts\|kyc-complete.e2e-spec.ts"` → expect empty.

- [ ] **Step 2: Delete both files.**

```bash
git rm api/test/kyc-submit.e2e-spec.ts api/test/kyc-complete.e2e-spec.ts
```

- [ ] **Step 3: Confirm the e2e project still lists (no dangling refs).**

Run: `pnpm --filter @handshake-agent/api exec jest --config test/jest-e2e.json --listTests >/dev/null`
Expected: exits 0, no reference to the deleted specs.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(api): remove /kyc/submit + /kyc/complete e2e suites (endpoints retired)"
```

---

## Phase B — remove the endpoints and their exclusive code

Now that nothing (e2e or, per the merge gate, FE) calls the endpoints, remove them and everything only they used. Each task is red→green: delete the pinning test(s) with the code, then confirm the suite compiles/passes.

### Task 5: Remove the two endpoints + their service/repo methods + DTOs + domain errors

**Files:**
- Modify: `api/src/modules/identity/presentation/kyc.controller.ts` (remove `complete()` + `submit()`; keep `setPin()`)
- Modify: `api/src/modules/identity/presentation/kyc.controller.spec.ts` (drop the `complete`/`submit` describe blocks; keep `setPin`)
- Delete: `api/src/modules/identity/presentation/dto/kyc-submit.dto.ts`
- Delete: `api/src/modules/identity/presentation/dto/kyc-complete.dto.ts`
- Modify: `api/src/modules/identity/application/kyc.service.ts` (remove `completeVerification` + `completeVerificationForUser` + their I/O interfaces; keep `createSumsubSession`; drop the now-unused `PinService` injection and `ContactNotFoundError`/`KycRejectedError`/`KycVerifyInput` imports)
- Modify: `api/src/modules/identity/application/kyc.service.spec.ts` (drop the `completeVerification*` describe blocks; keep `createSumsubSession`)
- Modify: `api/src/modules/identity/application/ports/kyc.repository.port.ts` (remove `completeVerificationAtomic` + `completeVerificationForUserAtomic` methods + their 4 I/O interface blocks; keep everything else)
- Modify: `api/src/modules/identity/infrastructure/kyc.prisma.repository.ts` (remove the two `complete*Atomic` implementations; keep the Sumsub/admin methods)
- Modify: `api/src/modules/identity/infrastructure/kyc.prisma.repository.spec.ts` (drop the `complete*Atomic` tests if present)
- Modify: `api/src/modules/identity/domain/kyc-errors.ts` (remove `ContactNotFoundError`, `KycRejectedError`, `KYC_REJECTED_USER_MESSAGE`; keep `KycDomainError`, `SumsubPrerequisiteNotMetError`, `AlreadyVerifiedError`)
- Modify: `api/src/modules/identity/identity.module.ts` (remove `WalletsModule` import + its usage **iff** the controller no longer needs `WalletService` — verify)

**Interfaces:**
- Consumes: the Task 0 greps proving these are the only consumers.
- Produces: `KycController` with only `setPin()`; `KycService` with only `createSumsubSession()`; `IKycRepository` without the two `complete*Atomic` methods.

- [ ] **Step 1: Update the pinning tests first (red).** In `kyc.controller.spec.ts` and `kyc.service.spec.ts`, delete the `describe`/`it` blocks that exercise `complete`/`submit`/`completeVerification*`. Keep the `setPin` and `createSumsubSession` blocks. In `kyc.prisma.repository.spec.ts`, delete any `complete*Atomic` cases.

- [ ] **Step 2: Run the trimmed unit suites to confirm they now reference only surviving code.**

Run: `pnpm --filter @handshake-agent/api test -- kyc.controller kyc.service kyc.prisma.repository`
Expected: the surviving cases still PASS (the deleted cases are gone; nothing references removed methods yet because the code still exists).

- [ ] **Step 3: Remove the controller handlers.** In `kyc.controller.ts`, delete the `@Post('complete')` `complete()` and `@Post('submit')` `submit()` methods and their imports that become unused: `KycCompleteDto`, `KycSubmitDto`, `HandoffTokenService`, `ContactNotFoundError`, `KycRejectedError`, `HandoffTokenDomainError`, and `WalletService` (its only use was best-effort provisioning inside these two handlers). Keep `setPin()`, `PinSetupService`, `JwtAuthGuard`, `CurrentUser`, `SetPinDto`, the `pin-setup-errors` imports, and `KycCompleteResponse`/`SetPinResponse` only if still referenced (they are not after removal — drop `KycCompleteResponse`). Remove the two DTO files.

- [ ] **Step 4: Remove the service methods.** In `kyc.service.ts`, delete `completeVerification`, `completeVerificationForUser`, and the `CompleteVerification*Input`/`Result` interfaces. Remove the constructor's `PinService` param and the `pinService` field, and the now-unused imports (`PinService`, `ContactNotFoundError`, `KycRejectedError`, `KycVerifyInput`). Keep `createSumsubSession` and its imports (`KycTier`/`KycTierLevel`, `tierAtLeast`, `SumsubPrerequisiteNotMetError`, `IIdentityRepository`, `IKycProvider`, `IKycRepository`).

- [ ] **Step 5: Remove the repo methods.** In `kyc.repository.port.ts`, delete the `completeVerificationAtomic` + `completeVerificationForUserAtomic` method signatures and the `CompleteVerificationAtomicInput/Result` + `CompleteVerificationForUserAtomicInput/Result` interfaces. In `kyc.prisma.repository.ts`, delete the two implementations (and any imports only they used). Keep all Sumsub/admin methods.

- [ ] **Step 6: Remove the domain errors.** In `kyc-errors.ts`, delete `ContactNotFoundError`, `KycRejectedError`, and the `KYC_REJECTED_USER_MESSAGE` const. Keep the base + `SumsubPrerequisiteNotMetError` + `AlreadyVerifiedError`.

- [ ] **Step 7: Fix module wiring.** In `identity.module.ts`, check whether `WalletService` / `WalletsModule` is still needed. `grep -n "WalletService\|WalletsModule\|walletService" api/src/modules/identity` — if the only consumer was the removed controller handlers, remove the `WalletsModule` import from `imports:` and delete its now-orphan doc comment (WN-3). If any surviving provider still needs it, leave it.

- [ ] **Step 8: Typecheck + run the identity unit suites + depcruise.**

Run:
```bash
pnpm --filter @handshake-agent/api typecheck
pnpm --filter @handshake-agent/api test -- identity
pnpm depcruise
```
Expected: PASS, clean. Fix any dangling import the compiler flags.

- [ ] **Step 9: Commit**

```bash
git add -A api/src/modules/identity
git commit -m "feat(api): remove /kyc/submit + /kyc/complete and their exclusive service/repo/domain code"
```

### Task 6: Remove `IKycProvider.verify()` from the port and both adapters

**Files:**
- Modify: `api/src/modules/identity/application/ports/kyc-provider.port.ts` (remove `verify()` from the interface + `KycVerifyInput` + `KycVerifyResult`; keep `createVerificationSession`, its shapes, `KycTierValue`)
- Modify: `api/src/modules/identity/infrastructure/sumsub-kyc.provider.ts` (remove the fail-closed `verify()` + its `KycVerifyInput`/`KycVerifyResult` imports; keep the HMAC helpers + `createVerificationSession`)
- Modify: `api/src/modules/identity/infrastructure/mock-kyc.provider.ts` (remove `verify()` + the `KycVerifyInput`/`KycVerifyResult` imports + the now-unused `randomUUID` import; keep `createVerificationSession`)
- Delete: `api/src/modules/identity/infrastructure/mock-kyc.provider.spec.ts` (it tests only `verify()`) — OR trim it to `createVerificationSession` if that method has coverage worth keeping; the mock's `createVerificationSession` is exercised by `kyc-sumsub-token` e2e, so deletion is acceptable.

**Interfaces:**
- Consumes: Task 5 (no `verify()` callers remain once the service methods are gone).
- Produces: `IKycProvider` with only `createVerificationSession`.

- [ ] **Step 1: Confirm no remaining `verify()` caller** (Task 5 removed both): `grep -rn "kycProvider.verify\|\.verify(" api/src/modules/identity --include="*.ts" | grep -v "\.spec\."` → expect empty.

- [ ] **Step 2: Remove `verify()` from the interface** in `kyc-provider.port.ts`, plus the `KycVerifyInput` and `KycVerifyResult` interfaces. Keep `KycTierValue`, `CreateVerificationSessionInput/Result`, and `createVerificationSession`.

- [ ] **Step 3: Remove `verify()` from both adapters** (`sumsub-kyc.provider.ts`, `mock-kyc.provider.ts`) and drop the now-unused imports. Delete/trim `mock-kyc.provider.spec.ts`.

- [ ] **Step 4: Typecheck + run identity unit + the Sumsub provider spec.**

Run:
```bash
pnpm --filter @handshake-agent/api typecheck
pnpm --filter @handshake-agent/api test -- kyc-provider sumsub-kyc identity.module
```
Expected: PASS. `sumsub-kyc.provider.spec.ts` (HMAC signing + `createVerificationSession`) still passes; the `KYC_MOCK_MODE` binding factory test still passes.

- [ ] **Step 5: Commit**

```bash
git add -A api/src/modules/identity
git commit -m "feat(api): drop IKycProvider.verify() from port + Sumsub/mock adapters (fail-closed TODO removed)"
```

### Task 7: Retire the WhatsApp handoff-token code + repoint the CTA to a plain onboarding link

**Files:**
- Delete: `api/src/modules/identity/application/handoff-token.service.ts`
- Delete: `api/src/modules/identity/application/handoff-token.service.spec.ts`
- Delete: `api/src/modules/identity/application/ports/handoff-token.repository.port.ts`
- Delete: `api/src/modules/identity/infrastructure/handoff-token.prisma.repository.ts`
- Delete: `api/src/modules/identity/domain/handoff-token-errors.ts`
- Delete: `api/test/handoff-token.e2e-spec.ts`
- Modify: `api/src/modules/identity/identity.module.ts` (remove `HandoffTokenService`, `HANDOFF_TOKEN_REPOSITORY` + `HandoffTokenPrismaRepository` providers/imports/exports)
- Modify: `api/src/modules/conversations/application/conversation.service.ts` (drop the `HandoffTokenService` import + constructor injection; rewrite `sendKycHandoff` to a token-less onboarding link)
- Modify: `api/src/modules/conversations/application/conversation.service.spec.ts` (update the handoff test — it no longer asserts a minted token)
- Modify: `api/src/core/config/configuration.ts` (add the onboarding web-path default)
- **Do NOT modify** `api/prisma/schema/` — the `HandoffToken` model stays dormant (Global Constraints).

**Interfaces:**
- Consumes: Task 5 (`kyc.controller` no longer calls `consumeKycToken`).
- Produces: `ConversationService.sendKycHandoff` builds `${WEB_APP_BASE_URL}${onboarding.webPath}` (default `/get-started`); no handoff-token code remains.

- [ ] **Step 1: Add the onboarding path default to config.** In `configuration.ts`, add to the top-level returned config object (near other web/app-facing values) a block:

```ts
  onboarding: {
    // Web path the WhatsApp KYC CTA links to (joined onto WEB_APP_BASE_URL).
    // A developer default (§7); the FE serves this route (frontend plan → /get-started).
    webPath: '/get-started',
  },
```
If `configuration.ts` has a typed return interface, add `onboarding: { webPath: string };` to it in the matching spot.

- [ ] **Step 2: Update the conversation-service handoff test (red).** In `conversation.service.spec.ts`, find the `sendKycHandoff`/needs-KYC test. It currently expects `handoffTokenService.mintKycToken` to be called and a token URL sent. Change it to: with `WEB_APP_BASE_URL` set, expect `sender.sendCtaUrl` called with `url: '<base>/get-started'` and no token; with `WEB_APP_BASE_URL` unset, expect the text fallback. Remove the `HandoffTokenService` mock from the spec's providers.

```ts
    // WEB_APP_BASE_URL='https://app.example.com', onboarding.webPath default '/get-started'
    expect(sender.sendCtaUrl).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://app.example.com/get-started' }),
    );
```

- [ ] **Step 3: Run the spec to confirm it fails** against the current (token-minting) implementation.

Run: `pnpm --filter @handshake-agent/api test -- conversation.service`
Expected: FAIL (asserts `/get-started` URL but code still mints `/kyc?t=`).

- [ ] **Step 4: Rewrite `sendKycHandoff` + add the URL builder** in `conversation.service.ts`:

```ts
  private async sendKycHandoff(channelAddress: string): Promise<string> {
    const url = this.onboardingUrl();
    if (!url) {
      // WEB_APP_BASE_URL not configured → text fallback.
      return this.kycRequiredFallbackReply();
    }
    try {
      await this.sender.sendCtaUrl({
        to: channelAddress,
        body: 'To start transacting, please verify your identity. It only takes a minute.',
        buttonText: 'Verify now',
        url,
      });
      return "I've sent you a secure link to verify your identity.";
    } catch (err: unknown) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'sendKycHandoff failed — falling back to text reply',
      );
      return this.kycRequiredFallbackReply();
    }
  }

  /**
   * Builds the onboarding CTA URL from config. Returns '' when WEB_APP_BASE_URL
   * is unset (callers fall back to text). No token — the WhatsApp Contact links
   * to the web account later via Settings (onboarding spec §9.4).
   */
  private onboardingUrl(): string {
    const baseUrl = this.configService.get<string>('WEB_APP_BASE_URL') ?? '';
    if (!baseUrl) return '';
    const path =
      this.configService.get<string>('onboarding.webPath') ?? '/get-started';
    return `${baseUrl}${path}`;
  }
```
Then remove the `HandoffTokenService` import (line 35) and the `handoffTokenService` constructor param (line 166). Keep `kycRequiredFallbackReply` + `reverifyFallbackReply`.

- [ ] **Step 5: Delete the handoff-token files + fix module wiring.**

```bash
git rm api/src/modules/identity/application/handoff-token.service.ts \
       api/src/modules/identity/application/handoff-token.service.spec.ts \
       api/src/modules/identity/application/ports/handoff-token.repository.port.ts \
       api/src/modules/identity/infrastructure/handoff-token.prisma.repository.ts \
       api/src/modules/identity/domain/handoff-token-errors.ts \
       api/test/handoff-token.e2e-spec.ts
```
In `identity.module.ts` remove: the `HANDOFF_TOKEN_REPOSITORY` import (line 16), the `HandoffTokenService` import (line 22), the `HandoffTokenPrismaRepository` import (line 26), the `HandoffTokenService` provider (line 98), the `{ provide: HANDOFF_TOKEN_REPOSITORY, ... }` provider (lines 102–105), and the `HandoffTokenService` export (line 124). Update the K3 doc comment (line 69).

- [ ] **Step 6: Typecheck, run the affected unit suites, depcruise.**

Run:
```bash
pnpm --filter @handshake-agent/api typecheck
pnpm --filter @handshake-agent/api test -- conversation.service identity.module
pnpm depcruise
```
Expected: PASS (conversation-service handoff test now green on `/get-started`), depcruise clean. Confirm `grep -rn "HandoffTokenService\|mintKycToken\|consumeKycToken" api/src` → empty.

- [ ] **Step 7: Commit**

```bash
git add -A api/src/modules/identity api/src/modules/conversations api/src/core/config/configuration.ts
git commit -m "feat(api): retire WhatsApp handoff-token code; KYC CTA links to onboarding (HandoffToken model kept dormant)"
```

---

## Phase C — full verification

### Task 8: Whole-suite gates + targeted e2e

**Files:** none (verification).

- [ ] **Step 1: Static gates across the workspace.**

Run:
```bash
pnpm --filter @handshake-agent/api typecheck
pnpm --filter @handshake-agent/api test
pnpm depcruise
```
Expected: PASS, clean.

- [ ] **Step 2: Run the migrated + Sumsub e2e verticals** (Redis :6379 up; not concurrent with coverage).

Run:
```bash
pnpm --filter @handshake-agent/api test:e2e -- onboarding-vertical web-buy web-sell-send kyc-sumsub-token sumsub-webhook web-chat profile
```
Expected: PASS. Known pre-existing reds per repo notes (send-vertical velocity 6>5; admin-end-users tier) are unrelated — confirm they were red before your change if they appear.

- [ ] **Step 3: Prove `KYC_MOCK_MODE=false` no longer 500s the removed routes** (the whole point). Confirm the routes are gone (404, not 500) — a quick grep is sufficient since the controller no longer declares them:

Run: `grep -n "@Post('submit')\|@Post('complete')" api/src/modules/identity/presentation/kyc.controller.ts`
Expected: empty (only `@Post('pin')` remains). With Sumsub bound (`KYC_MOCK_MODE=false`), there is no `verify()` on the provider to throw.

- [ ] **Step 4: Add the frontend-plan coordination note.** Append one line to `docs/superpowers/plans/2026-07-13-onboarding-frontend.md` recording the dependency (do not implement FE here):

```markdown
> **Backend coordination (2026-07-13):** the legacy `/kyc/submit` + `/kyc/complete` endpoints and the WhatsApp handoff-token are retired backend-side (plan: `2026-07-13-retire-legacy-sync-kyc-endpoints.md`). This FE plan owns removing `web/app/onboarding`, `web/app/kyc`, `KycForm`/`OnboardingKycForm`, `web/lib/api/kyc.ts`, and the `KycComplete*`/`KycSubmit*` schemas in `packages/contracts/src/dto/kyc-complete.dto.ts`. The backend removal must merge after this FE cutover.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-13-onboarding-frontend.md
git commit -m "docs(api): record backend↔frontend coordination for legacy-KYC retirement"
```

---

## Self-review checklist (run before handing off to execution)

- **Spec coverage:** every spec §3 removal → Tasks 5–7; §4 WhatsApp handoff → Task 7; §5 e2e → Tasks 1–4; §6 boundary/merge-gate → Global Constraints + Task 8.4. ✔
- **Ordering:** e2e migrated (Phase A) before endpoint removal (Phase B) — no step 404s a live test. ✔
- **Dormant model:** no `api/prisma/schema/` edits, no migration. ✔
- **Sumsub paths preserved:** `createSumsubSession`, `/kyc/sumsub/token`, `/webhooks/sumsub`, all `*Sumsub*` repo methods, `/kyc/pin`. ✔
