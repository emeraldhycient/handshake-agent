# Retire the legacy synchronous NIN/BVN KYC path — design spec

- **Date:** 2026-07-13
- **Branch:** based on `feat/onboarding-redesign` (tip `543e9ee` at design time — a **live** branch; re-sync before implementing)
- **Status:** design, pending review
- **Depends on:** the onboarding redesign ([`2026-07-13-onboarding-redesign-design.md`](2026-07-13-onboarding-redesign-design.md), plans [`onboarding-backend`](../plans/2026-07-13-onboarding-backend.md) / [`onboarding-frontend`](../plans/2026-07-13-onboarding-frontend.md)). This is the "later cleanup, out of scope here" the backend plan deferred.
- **Related invariants:** root `CLAUDE.md` §3.1 (model proposes / engine disposes), §3.3 (server-side KYC gating), §3.4 (identity ≠ phone), §3.5 (WhatsApp full agent surface), §3.6 (no shortcuts / no dead code), §4 (clean arch), §7 (layered config), §8 (contracts), §9 (TDD).

---

## 1. Problem

The onboarding redesign moved identity verification to **Sumsub** (async: WebSDK access token + `applicantReviewed` webhook). Sumsub has no synchronous NIN/BVN-match equivalent, so `SumsubKycProvider.verify()` is intentionally **fail-closed** — it throws, carrying `TODO(KYC-TIER1-SUMSUB)`.

But two endpoints still call `IKycProvider.verify()`:

- `POST /kyc/submit` (JWT) → `KycService.completeVerificationForUser`
- `POST /kyc/complete` (public, handoff-token) → `KycService.completeVerification`

Their controller (`identity/presentation/kyc.controller.ts`) only maps `ContactNotFoundError` / `KycRejectedError`; the generic throw escapes as a **500**. So the moment `KYC_MOCK_MODE=false` ships (binding `SumsubKycProvider`), any caller of either endpoint gets a 500.

This is **not a launch blocker** — the new onboarding grants `tier_1` from email-OTP verification (`/auth/signup/verify`) and `tier_2`/`tier_3` from the Sumsub WebSDK + `/webhooks/sumsub`, none of which touch these endpoints. The endpoints are **dead in the intended end state**. This spec retires them.

### Current-branch reality (why sequencing matters)

The **backend** Sumsub path is built and e2e-tested (`onboarding-vertical.e2e-spec.ts`). The **frontend** redesign is **not built**: there is no `/get-started` route. `/onboarding` still renders `OnboardingKycForm` → `POST /kyc/submit`, and `/kyc` still renders `KycForm` → `POST /kyc/complete`. So today these endpoints are the backend of the **live** onboarding UI; they only become dead once the wizard (frontend plan) replaces those pages.

## 2. Decisions

Resolved during design review:

1. **Base branch:** rebase the work onto `feat/onboarding-redesign` (done — worktree reset to `543e9ee`). Re-sync to the branch tip immediately before implementing (the branch moves).
2. **Scope:** **backend only.** The FE `/onboarding` + `/kyc` pages, their components/clients, and the shared contract schemas are owned by the **frontend plan**.
3. **`/kyc/submit`:** **remove** (not repoint — a "repoint to a Sumsub session" would merely duplicate `POST /kyc/sumsub/token`, which already mints the WebSDK session).
4. **`/kyc/complete` + WhatsApp handoff:** **retire.** The WhatsApp handoff sends a **plain onboarding link** (no token); the handoff-token *code* is removed. Contact↔web-account linking defers to the "link WhatsApp in Settings" flow (onboarding spec §9.4).
5. **`HandoffToken` Prisma model:** **keep dormant.** Remove all handoff-token code, but keep the model + `HandoffPurpose`/`HandoffTokenStatus` enums + `User`/`Conversation` back-relations + `ReplyRow.handoffTokenId` column. The model was designed generic (`kyc | confirmation | pin_reset | device_binding`; only `kyc` implemented) and holds a persisted conversation-history reference — so **no schema migration** and no conversation-history churn. Nothing currently writes `handoffTokenId`, so keeping it dormant is zero-cost on the conversations side.
6. **e2e:** delete the endpoint-specific suites; extract a shared verified-user helper; migrate the ~10 setup suites to the new email-OTP + Sumsub-webhook path.

## 3. Backend removal set

Clean-arch per §4 (`presentation → application → domain`; `infrastructure` implements ports). Strict TDD (§9): for each removal, first delete/adjust the test that pins the removed behavior (red), then delete the code (green), then confirm the suite + typecheck + depcruise are clean.

### 3.1 Presentation

- `identity/presentation/kyc.controller.ts`: remove `complete()` and `submit()`. **Keep `setPin()`** (the `/kyc/pin` route is unchanged and still needed). Drop the now-unused imports (`HandoffTokenService`, `WalletService` if only used by the removed handlers — verify; `provisionAllEnabledNetworks` eager-provisioning moves nowhere, it was best-effort on these paths only).
- Remove `presentation/dto/kyc-submit.dto.ts` and `presentation/dto/kyc-complete.dto.ts` (backend `nestjs-zod` wrappers). These import the contract schemas but are backend-only; deleting them does not touch `packages/contracts`.

> **Wallet eager-provisioning note:** both removed handlers called `walletService.provisionAllEnabledNetworks` (best-effort, WN-3). Confirm the new onboarding flow provisions wallets elsewhere (it does — lazy `getOrProvisionNetworkWallet` in buy/receive is the documented fallback, and the onboarding vertical relies on it). No provisioning behavior is lost for real users; only the eager optimization on two dead endpoints goes away.

### 3.2 Application

- `identity/application/kyc.service.ts`: remove `completeVerification` + `completeVerificationForUser` (+ their input/output interfaces). **Keep `createSumsubSession`.**
- `application/ports/kyc-provider.port.ts`: remove `verify()` from `IKycProvider`, plus `KycVerifyInput` / `KycVerifyResult`. **Keep `createVerificationSession` + its shapes.**
- `application/ports/kyc.repository.port.ts` + `infrastructure/kyc.prisma.repository.ts`: remove `completeVerificationAtomic` + `completeVerificationForUserAtomic` (dead once the service methods go) and their input/output shapes. **Keep `setSumsubApplicantId`** (used by `createSumsubSession`) and the tier-grant write path used by the Sumsub webhook.
- `application/handoff-token.service.ts`: **remove entirely** (`mintKycToken`, `consumeKycToken`, TTL/URL logic).
- `application/ports/handoff-token.repository.port.ts`: **remove entirely.**

### 3.3 Infrastructure

- `sumsub-kyc.provider.ts`: remove the fail-closed `verify()` method (deletes the `TODO(KYC-TIER1-SUMSUB)`). Keep the HMAC signing helpers + `createVerificationSession`.
- `mock-kyc.provider.ts`: remove its `verify()`. If `MockKycProvider` becomes an empty shell after that, keep only `createVerificationSession` (it's still the `KYC_MOCK_MODE=true` binding for dev/e2e). Verify the class still satisfies the trimmed `IKycProvider`.
- `infrastructure/handoff-token.prisma.repository.ts`: **remove entirely.**

### 3.4 Domain

- `domain/handoff-token-errors.ts`: **remove entirely** (only consumed by the removed service + controller).
- `domain/kyc-errors.ts`: remove `ContactNotFoundError` and `KycRejectedError` **iff** no other references survive (grep first). **Keep `SumsubPrerequisiteNotMetError`** (used by `createSumsubSession`).

### 3.5 Module wiring

- `identity/identity.module.ts`: drop the `HandoffTokenService` + handoff-repo providers/exports. Keep the `KYC_PROVIDER` factory (`selectKycProvider`) — it now resolves a provider exposing only `createVerificationSession`, so no method can fail-closed and `KYC_MOCK_MODE=false` no longer 500s.

### 3.6 Result

`KYC_PROVIDER` (Sumsub or mock) exposes only `createVerificationSession`. The existing `KYC_MOCK_MODE` prod boot guard (commit `385487b`) stands — **no new config guard is required**.

## 4. WhatsApp handoff change

`conversations/application/conversation.service.ts` → `sendKycHandoff(channelAddress)`:

- **Before:** `handoffTokenService.mintKycToken(...)` → `${WEB_APP_BASE_URL}/kyc?t=<token>` → CTA-URL button.
- **After:** build a token-less onboarding URL `${WEB_APP_BASE_URL}${onboardingWebPath}` and send the same CTA-URL button (copy unchanged: "To start transacting, please verify your identity…"). Text fallback (`WEB_APP_BASE_URL` unset) unchanged.
- `onboardingWebPath` is a **code-default config** value (`configuration.ts`, default `/get-started`) — not hardcoded (§7). Coordinates with the frontend plan, which creates `/get-started` and redirects `/signup` + `/onboarding` to it.
- `requireActiveUser` still returns `{ needsKyc }` / `{ needsReverify }`; only the URL construction inside `sendKycHandoff` changes. `conversation.service` no longer injects `HandoffTokenService`.

**Identity note (§3.4 / §3.5):** the seamless WhatsApp-Contact→web-account binding the token provided is intentionally dropped here; it is superseded by explicit "link WhatsApp in Settings" (onboarding spec §9.4). WhatsApp remains a full agent surface — the user still gets an in-thread CTA into onboarding; only the auto-link is deferred. `HandoffToken` stays in the schema (dormant) so a future generic handoff (confirmation / pin_reset / device_binding) can reuse it without a re-add.

## 5. e2e strategy

`14` e2e specs reference the endpoints. Two test the endpoints themselves; the other **twelve** use `/kyc/submit` only as **setup** to mint a verified user — including the two new Sumsub suites (`kyc-sumsub-token`, `sumsub-webhook`), which currently seed their `tier_1` user via `/kyc/submit` before exercising the Sumsub path.

- **Delete:** `api/test/kyc-submit.e2e-spec.ts`, `api/test/kyc-complete.e2e-spec.ts`. Delete the corresponding unit specs for removed code (`mock-kyc.provider.spec.ts`; the `verify()`-path tests in `kyc.service.spec.ts`; `handoff-token.service.spec.ts`; `api/test/handoff-token.e2e-spec.ts`). Keep the parts of `kyc.controller.spec.ts` covering `setPin()`.
- **Extract:** `api/test/helpers/mint-verified-user.ts` — `/auth/signup/request` → `/auth/signup/verify` (tier_1 + session), plus an optional signed-Sumsub-webhook step for `tier_2`/`tier_3`. Reuse the HMAC `x-payload-digest` signing helper from `sumsub-webhook.e2e-spec.ts` and `helpers/drain-webhooks`. This is exactly the path `onboarding-vertical.e2e-spec.ts` already exercises — factor from it so there is one canonical helper (§13.1).
- **Migrate:** the twelve setup suites — `web-buy`, `web-balance`, `wallet-reads`, `transaction-list`, `transaction-history`, `web-chat`, `web-sell-send`, `web-voice`, `kyc-wallet-provision`, `profile`, `kyc-sumsub-token`, `sumsub-webhook` — from the legacy `signup → verify-email → login → kyc/submit` sequence to the helper. Suites asserting send/sell/swap add the `tier_2` webhook step (the branch already bumped these to tier_2). The two Sumsub suites become fully consistent — seeding `tier_1` via the same email-OTP helper they then upgrade through Sumsub.

**Verification (§9):** api unit suite + `test:e2e` (testcontainers, needs Redis :6379; never run api coverage + e2e concurrently — false timeouts) green; `pnpm lint && pnpm typecheck && pnpm depcruise` clean.

## 6. Out of scope — the frontend plan boundary

This task **does not** touch `web/` or `packages/contracts`. The frontend plan owns, and removes when it lands the wizard:

- `web/app/onboarding/page.tsx`, `web/app/kyc/page.tsx`
- `web/components/kyc/KycForm.tsx`, `web/components/kyc/OnboardingKycForm.tsx` (+ their helpers)
- `web/lib/api/kyc.ts` (`postKycComplete`, `postKycSubmit`)
- `packages/contracts/src/dto/kyc-complete.dto.ts` (`KycComplete*` / `KycSubmit*` schemas) — removable once no FE importer remains.

A one-line dependency note will be added to the frontend plan so both sides record the coupling.

### Sequencing / merge gate

**This backend removal must merge after the frontend cutover has stopped calling `/kyc/submit` + `/kyc/complete`.** Because this task leaves the contract schemas untouched, the FE keeps compiling regardless of merge order — only runtime calls matter, and FE-first eliminates them. If backend were to merge first, the still-live `/onboarding` + `/kyc` pages would 404 at runtime.

## 7. Invariant checklist

- **§3.1** No LLM output moves money — untouched; this is pre-transaction cleanup. ✔
- **§3.2** Agent has no DB access — no agent changes. ✔
- **§3.3** Server-side KYC/limit/sanctions gate — *strengthened*: the only remaining verified-tier grants are email-OTP (`tier_1`) and the signed Sumsub webhook (`tier_2`/`tier_3`); a synchronous, model-adjacent NIN/BVN grant path is gone. ✔
- **§3.4** Identity ≠ phone — preserved (email + device + PIN + Sumsub); WhatsApp auto-link deferred to explicit Settings linking. ✔
- **§3.5** WhatsApp full agent surface — in-thread onboarding CTA retained; only the token auto-link is deferred. ✔
- **§3.6** No shortcuts / no dead code — the fail-closed `verify()` + its dead callers are **removed**, not stubbed. The dormant `HandoffToken` model is a **deliberate, documented** retention of a generic mechanism, not an accidental leftover. ✔

## 8. Risks & rollback

- **Merge-order breakage** (mitigated by §6 sequencing gate). Rollback = revert this backend PR; the endpoints return.
- **Missed `verify()` / handoff consumer** — mitigated by grepping each symbol's blast radius before deletion (already done at design time: `verify()` has exactly the two service callers; `mintKycToken` one caller; `consumeKycToken` one caller; `HandoffToken` purpose is `kyc`-only in code).
- **Dormant model drift** — a reviewer may flag the unused table as dead code; the §2.5 rationale + a schema comment ("retained for future generic handoffs; KYC usage retired 2026-07-13") document intent.

## 9. Open items

None blocking. Confirm at implementation time (re-sync to branch tip first): (a) `ContactNotFoundError` / `KycRejectedError` have no surviving references before deleting them; (b) `WalletService` injection in the controller is only used by the removed handlers; (c) the `onboardingWebPath` default value with the frontend plan (`/get-started`).

---

*Next: on approval → `writing-plans` produces the phased implementation plan (grep-confirm blast radius → e2e helper + migrate setup suites → remove endpoints/service/provider `verify()` → retire handoff code → WhatsApp link repoint → gates green).*
