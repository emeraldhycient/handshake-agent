# Web onboarding redesign — design spec

- **Date:** 2026-07-13
- **Branch:** `feat/onboarding-redesign`
- **Status:** design, pending review
- **Designs (source of truth):** Claude Design project `99aef22a-9c3e-41f5-b3f4-c413ff34b477`
  - Desktop: `Handshake Onboarding Desktop.dc.html`
  - Mobile: `Handshake Onboarding.dc.html`
- **Related invariants:** root `CLAUDE.md` §3.1 (model proposes / engine disposes), §3.3 (server-side KYC gating), §3.4 (identity ≠ phone), §3.6 (no shortcuts), §4 (clean arch), §7 (layered config), §8 (contracts), §16 (componentisation)

---

## 1. Goal

Replace the current split signup (`/signup` email+phone → verify **link**) + `/onboarding` (NIN/BVN + PIN form) with a **single guided onboarding wizard** that matches the approved mockups, and move identity verification to **Sumsub** (document + liveness + proof-of-address). A new user can get into the app immediately on email verification and finish (or resume) KYC later.

The mockup is a client-side state machine:

```
Welcome → Email → 6-digit OTP → Name → PIN (+confirm)
        → "Verify now / Explore later"
        → [Sumsub doc+liveness]  → Done (wallet, usable)
```

Desktop = persistent brand rail + vertical step-tracker + cream form panel, keyboard OTP boxes, PIN+confirm on one screen. Mobile = full-bleed welcome, 4-segment progress bar, on-screen numeric keypad, PIN split into create → confirm screens. Both are honoured 1:1.

## 2. Tier / status model (the core change)

### 2.1 The ladder

| Tier | Trigger | Capabilities unlocked | NGN caps (existing config) |
|------|---------|-----------------------|----------------------------|
| `unverified` | new account, pre-email-verify | none | — (blocked before limits) |
| `tier_1` | **email OTP verified** | **buy, receive** (fund & hold) | ₦50k/tx · ₦200k/day |
| `tier_2` | **Sumsub document + liveness** (GREEN) | **+ send, sell/cash-out, swap** | ₦500k/tx · ₦2M/day |
| `tier_3` | **Sumsub proof-of-address** (utility bill / bank statement / any Sumsub-supported address doc, GREEN) | higher limits | ₦5M/tx · ₦20M/day |

`kycTier` = capability level. `kycStatus` = identity-verification lifecycle: `not_started → pending_review → verified | rejected` (enum values already exist in `KycStatus`). A `tier_1` email user has `kycTier=tier_1` while `kycStatus` is *not* `verified` (verified is reserved for a completed Sumsub review). The mockup's "Verified/Unverified" badge reflects `kycStatus`, not tier.

### 2.2 Capability → minimum-tier gate

Today `KycGateService.assertBaselineEligibility` is **status-only** (`kycStatus !== 'verified' → block`) and there is **no per-capability tier rule** — all verified tiers share capabilities and differ only by numeric limits. This spec introduces a capability→min-tier map:

| Capability | Minimum tier |
|------------|--------------|
| `crypto.buy` | `tier_1` |
| `crypto.receive` | `tier_1` (inbound; effectively ungated once the address exists) |
| `crypto.sell` (cash-out) | `tier_2` |
| `crypto.send` | `tier_2` |
| `crypto.swap` | `tier_2` |

The gate stops requiring `kycStatus==='verified'` and instead requires `kycTier >= minTierFor(capability)` (with `unverified` = 0). Numeric limits continue to resolve per-tier exactly as today. The map is **config-driven** (a new `limits`-adjacent registry entry, admin-tunable per §7) so raising/lowering a capability's floor is not a code change. This + the tier_1 grant are the money-path core → **strict TDD + api e2e**.

`tier_2` and `tier_3` share the same *capabilities*; they differ only by numeric limits — so the gate's min-tier for send/sell/swap is `tier_2`, and `tier_3` is purely a limit bump. `tier_2` is no longer "reserved/admin-only": it is the doc+liveness rung.

## 3. Backend design

Clean-arch placement per §4 — `presentation → application → domain`, `infrastructure` implements ports.

### 3.1 Auth: email-only OTP signup + tier_1 on verify

- **Signup becomes email-only + OTP.** `POST /auth/signup` takes `{ email }` (phone dropped), creates the `provisional` user (or resumes an existing unverified one), and sends a **6-digit OTP** (reusing the existing login-OTP infra: `auth.otp` config, 6 digits, 5 min, 5 attempts) instead of a verify link. Response `{ status: 'otp_sent', devOtp? }` (dev echo behind `AUTH_DEV_EXPOSE_OTP`).
- **Verify grants a session and tier_1.** `POST /auth/signup/verify` `{ email, otp, deviceFingerprint }` → validates OTP, stamps `emailVerifiedAt`, **sets `kycTier=tier_1` + `tierChangedAt=now`**, sets `status=active`, and issues the session (access token + HttpOnly `ha_refresh` cookie) exactly like `login/verify`. Returns `LoginVerifyResponse`.
- The existing link-based `POST /auth/verify-email` remains for any legacy pending users but is **not** used by the new flow. `/auth/login/*` is unchanged (existing users).
- **Account enumeration:** signup on an already-*verified* email returns the same `{ status: 'otp_sent' }` shape but sends a "you already have an account, log in" email rather than an OTP (no oracle). Detail pinned in the plan.

### 3.2 Name step

- `POST /profile/name` `{ firstName, lastName }` (JWT) → writes `KycProfile.firstName/lastName` (upsert). Idempotent; re-submittable. Powers wizard step 3.

### 3.3 PIN-before-KYC

- Relax `PinSetupService.setTransactionPin`'s gate from `kycStatus === 'verified'` to **`kycTier !== 'unverified'`** (i.e. ≥ tier_1). A tier_1 email user can set their PIN. `POST /kyc/pin` unchanged in shape (`SetPinRequest`, weak-PIN rejection preserved). `hasPin` stays derived from `pinHash`.

### 3.4 Sumsub KYC provider (replaces the NIN/BVN mock path)

Sumsub is applicant + webhook driven (async), unlike the current synchronous `IKycProvider.verify()`. We **add an async path** rather than force Sumsub through the sync port:

- **Port** (`identity/application/ports/kyc-provider.port.ts`) gains:
  - `createVerificationSession(input: { userId; level }): Promise<{ token; applicantId }>` — mints a Sumsub **access token** (`POST /resources/accessTokens` HMAC-signed with app token + secret, `externalUserId = userId`, `levelName` from config) for the WebSDK.
  - `applyReviewResult(payload): { userId; grantTier; approved; reason? }` — pure mapping of a verified Sumsub webhook to a tier grant.
  - The existing sync `verify()` stays for `MockKycProvider` (local/e2e/visual-verify without real Sumsub).
- **Adapter** `SumsubKycProvider` in `identity/infrastructure/`, config-gated (mock fallback via a `KYC_MOCK_MODE`-style flag, matching `PAYMENTS_MOCK_MODE`/`SWAP_MOCK_MODE`). Binding swap in `identity.module.ts` (one `useClass`/factory line, same isolation pattern as `WALLET_PROVIDER`).
- **Token endpoint** `POST /kyc/sumsub/token` `{ level: 'tier_2' | 'tier_3' }` (JWT) → returns `{ token }`. Onboarding requests `tier_2`; Settings offers `tier_2` (if not yet attained) then `tier_3`. The user must have completed the prerequisite rung (tier_3 requires tier_2) — enforced server-side.
- **Webhook** `POST /webhooks/sumsub` registered in the existing **persist-first webhook queue** (`webhooks` module: verify signature → persist → ACK → durable handler). Signature verified with `SUMSUB_WEBHOOK_SECRET` (payload HMAC digest, per Sumsub spec). Handler on `applicantReviewed`:
  - `reviewResult.reviewAnswer === GREEN` → grant the tier the payload's `levelName` maps to (config map `levelName → tier`), set `kycStatus=verified` (Sumsub GREEN = identity verified; note tier_1 email users keep `kycStatus=not_started` since only their email is confirmed), `tierChangedAt=now`, persist `idDocumentType`/`livenessCheckResult`/`sumsubApplicantId` onto `KycProfile`.
  - `RED` → `kycStatus=rejected` + `rejectionReason`; tier unchanged (user keeps prior capabilities, can retry).
  - In-progress/submitted → `kycStatus=pending_review` (drives the "in review" UI + Settings "resume").
- **Tier-grant threading fix:** the `TODO(KYC-TIER)` write sites in `kyc.prisma.repository.ts` (+ the port) stop hardcoding `tier_1` and take the granted tier from the provider/webhook result.

### 3.5 Config, env, migration

- **Config (§7):** `catalog.capabilities` gains (or a sibling registry gains) the capability→min-tier map; `SUMSUB` level→tier map; a KYC-provider enable flag. Admin-tunable via the DB-admin layer where it's a business value.
- **Env (`env.schema.ts` + `.env.example`):** `SUMSUB_API_TOKEN` (present), `SUMSUB_API_SECRET_KEY` (present), **`SUMSUB_WEBHOOK_SECRET`** (to add), `SUMSUB_BASE_URL`, `SUMSUB_LEVEL_TIER2`, `SUMSUB_LEVEL_TIER3` (level names configured in the Sumsub dashboard), a `KYC_MOCK_MODE` flag. Secrets = env; level names/flags could be config. Zod-validated at boot (fail-closed).
- **Migration:** add `sumsubApplicantId String?` to `KycProfile` (webhook correlation is via `externalUserId=userId`, but storing the applicant id supports status re-fetch). No new tables. `KycStatus`/`KycTier` enums already cover the needed states.

## 4. Frontend design

Layering per §4.2 (`app/ → components/ → lib/ → types/`) and componentisation per §16 (pages orchestrate; sections in `components/<feature>/`; hooks in `hooks/`; constants in `constants/`; types in `types/`).

### 4.1 Routes

- **New `/get-started`** — the wizard. Public (creates the account). Desktop + mobile variants chosen by viewport (`use-is-desktop`), mirroring `AdaptiveExperience`.
- `/signup` and `/onboarding` → **redirect** to `/get-started` (preserve inbound links).
- `/login` — **restyled** to the new aesthetic (brand rail / cream card), same email→OTP mechanic. On success, route by state: has PIN → `/`; missing PIN (dropped mid-onboarding) → `/get-started` (resume).
- `/kyc` WhatsApp handoff → re-points to the Sumsub flow (handoff token → Sumsub session) rather than the NIN/BVN form.
- `/verify-email` link page retained for legacy only.

### 4.2 Wizard structure (client state machine)

- One orchestrator route `app/get-started/page.tsx` (thin) + a `components/onboarding/OnboardingWizard.tsx` state machine driving section components: `WelcomeStep`, `EmailStep`, `OtpStep`, `NameStep`, `PinStep`, `KycChoiceStep`, `SumsubStep`, `DoneStep`. Desktop chrome (`OnboardingRail` with the step-tracker) vs mobile chrome (`OnboardingProgress` + `Keypad`) wrap the same steps.
- Each step calls its own lib hook (`lib/query/*`): `useSignup`(email→OTP), `useSignupVerify`(OTP→session+tier_1), `useSetName`, `useSetPin`, `useSumsubToken`. All bodies parse through `@handshake-agent/contracts` before send (§5).
- **Resumability:** on mount, read `/auth/me` (extended). Derive the entry step: no session → welcome/email; session + `!emailVerified` → otp; `+ !firstName` → name; `+ !hasPin` → pin; `+ hasPin` → kyc-choice or straight into the app. State machine is pure-derivable so reload never loses place.
- PIN UI is **4-digit** to match the mockup; the backend keeps 4–6 + weak-PIN rejection, surfaced inline (so "1234"/"0000" show an error rather than silently passing).

### 4.3 Sumsub in the FE

- `@sumsub/websdk-react` launched from three entry points, all fetching a token via `useSumsubToken`: (1) onboarding "Verify now", (2) done-screen / home "Verify to unlock" banner, (3) **Settings → "Verify your identity"** section (the resume-later path) — hosted in `components/settings/` + `components/desktop/settings-page.tsx`, showing current tier, what each rung unlocks, and a CTA that launches the next-rung Sumsub flow. On SDK completion, status shows "in review" and the UI polls `/auth/me`.

### 4.4 Gating relaxation

- `RequireVerified` stops bouncing every non-`verified` user to onboarding. New predicate: authenticated + `hasPin` + `kycTier >= tier_1` → **admit to the app shell**; missing PIN or `unverified` → resume `/get-started`. Money-moving stays server-gated (§3.3) — the FE gate is UX only. Tier-scoped UI (e.g. "Verify to unlock sending") reads `kycTier`/`kycStatus` from `me`/`profile`.
- The mockup's done-screen (₦0 balance card, status badge, "verify to unlock" banner, "Open my wallet") becomes the real post-onboarding landing.

### 4.5 Design tokens

The mockup's palette (deep green `#1a4536`, amber `#f5a623`, cream `#f3efe7`, Figtree + IBM Plex Mono) is **already** the theme in `web/app/globals.css` (`--primary`, `--accent`, `--background`, fonts). No `tailwind.config.js`. Reuse shadcn primitives; no hex literals in components (§5/§13).

## 5. Contracts (`packages/contracts`)

One schema, three consumers (§8). New/changed:

- `auth/auth.dto.ts`: `SignupRequest` → `{ email }` only; add `SignupVerifyRequest` `{ email, otp, deviceFingerprint }` → `LoginVerifyResponse`; extend `MeResponse` with `emailVerified: boolean` (and keep `kycStatus`/`kycTier`/`hasPin`/`firstName`/`lastName`) for resumability.
- `dto/profile.dto.ts` (or new): `SetNameRequest` `{ firstName, lastName }`.
- New `kyc` schemas: `SumsubTokenRequest` `{ level }` → `SumsubTokenResponse` `{ token }`; Sumsub webhook payload schema (server-validated at the boundary).
- Capability→min-tier map surfaced read-only on `/config` if the FE needs it for gating copy (else derive from `kycTier` + `profile.limits`).

## 6. Testing

TDD, red→green→refactor (§9). ~100% on business logic; the money path is non-negotiable.

- **Domain/application (unit):** the capability→min-tier gate (each capability × each tier, allow/deny); tier_1 grant on email verify; PIN-before-KYC gate relaxation; Sumsub webhook → tier-grant mapping (GREEN/RED/pending, each level→tier); tier-threading through the KYC repo.
- **api e2e (testcontainers):** onboarding vertical — signup→OTP→verify(tier_1)→name→PIN→app; tier_1 **can buy, cannot send** (403 with actionable code); Sumsub webhook (signed) drives tier_2 → **can send**; tier_3 proof-of-address webhook → higher limits. Reuse the mock provider for deterministic webhooks. (e2e needs Redis :6379 up; never run api coverage + e2e concurrently.)
- **Contracts:** parse valid/invalid fixtures for every new schema.
- **web (Vitest + RTL):** wizard state machine (each step + resume derivation), PIN mismatch/weak-PIN inline errors, gating predicate, Settings verify section. **Playwright:** full onboarding pass (dev OTP), both viewports.
- **Visual verify:** desktop + mobile onboarding, Settings resume, login restyle — screenshots before certification.

## 7. Routing / back-compat summary

| Path | Before | After |
|------|--------|-------|
| `/get-started` | — | new wizard (desktop+mobile) |
| `/signup` | email+phone form | redirect → `/get-started` |
| `/onboarding` | NIN/BVN+PIN form | redirect → `/get-started` |
| `/login` | email→OTP (old style) | restyled, same mechanic |
| `/kyc?t=` | NIN/BVN form (WhatsApp handoff) | Sumsub flow |
| `/verify-email?token=` | link verify | legacy only |

## 8. Invariant checklist

- **§3.1** No LLM output moves money — untouched; onboarding is pre-transaction. ✔
- **§3.2** Agent has no DB access — no agent changes. ✔
- **§3.3** Server-side KYC/limit/sanctions gate on every money-move — *strengthened* (capability→min-tier added server-side; FE gate is UX). ✔
- **§3.4** Identity ≠ phone — phone dropped from signup; identity anchored to verified email + bound device + PIN + Sumsub. ✔
- **§3.6** No shortcuts — Sumsub is a real integration with a config-gated mock for local/e2e (not a placeholder); tier_3 collection is real (Sumsub proof-of-address). ✔

## 9. Open items / assumptions (confirm on review)

1. **tier_3 verification** = Sumsub proof-of-address (utility bill / bank statement / any supported address doc). **Confirmed.**
2. **Sumsub level names** for tier_2 (doc+liveness) and tier_3 (proof-of-address) come from config/env — the operator supplies the exact level names configured in the Sumsub dashboard. **You provide these.**
3. **`SUMSUB_WEBHOOK_SECRET`** must be added to `.env` (not present yet) for webhook signature verification.
4. **Phone** dropped from onboarding; captured later (optional WhatsApp linking in Settings). **Confirmed.**
5. **Login** restyled to match. **Confirmed.**
6. **PIN** stays 4-digit in the UI; backend keeps 4–6 + weak-PIN rejection. **Assumed.**
7. WhatsApp `/kyc` handoff re-points to Sumsub. **Assumed.**

---

*Next: on approval → `writing-plans` skill produces the phased implementation plan (contracts → backend gate/auth/Sumsub → FE wizard → settings/login → e2e + visual verify).*
