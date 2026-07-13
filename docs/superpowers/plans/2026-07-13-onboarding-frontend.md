# Onboarding Redesign — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Visual source of truth:** the two Claude Design mockups (`Handshake Onboarding Desktop.dc.html`, `Handshake Onboarding.dc.html`) in Claude Design project `99aef22a-9c3e-41f5-b3f4-c413ff34b477` — re-fetch via `DesignSync get_file` and materialize to the scratchpad at implementation time; match them 1:1.

**Goal:** Build the guided onboarding wizard (desktop rail + mobile keypad) at `/get-started`, launch Sumsub for verification, admit `tier_1` users into the app, add a Settings "Verify your identity" resume path, and restyle Login to match.

**Architecture:** Next 16 App Router. Strict downward layering (§4.2): `app/` orchestrates, `components/<feature>/` renders, `lib/` talks to the world, `types/` holds shapes. The wizard is a **client state machine** driving stateless step endpoints; resume is derived from `/auth/me`. TanStack Query owns server state, Zustand owns wizard UI state, Axios (single instance) sends with `withCredentials` + `Idempotency-Key`. Shapes come from `@handshake-agent/contracts` (§8). Componentisation §16 (pages orchestrate; sections ≤150 lines; hooks in `hooks/`; constants in `constants/`; types in `types/`).

**Tech Stack:** Next 16, React 19, Tailwind v4 (CSS-first, tokens in `globals.css`, **no `tailwind.config.js`**), shadcn (`radix-vega`), TanStack Query, Zustand, Axios, `@sumsub/websdk-react`, Vitest + RTL, Playwright.

## Global Constraints

- Depends on the **backend plan** contracts/endpoints (`SignupRequest` email-only, `POST /auth/signup`+`/signup/verify`, `POST /profile/name`, `POST /kyc/pin` (tier_1-allowed), `POST /kyc/sumsub/token`, `MeResponse.emailVerified`, capability→min-tier gate).
- Tokens only — no hex literals (§5/§13). The mockup palette (`#1a4536` green, `#f5a623` amber, `#f3efe7` cream, Figtree + IBM Plex Mono) already maps to `--primary`/`--accent`/`--background`/fonts in `web/app/globals.css`. Use the tokens.
- Every API client parses body through the Zod schema before the request and parses the response after (§5). Mutations carry `Idempotency-Key` (already in the Axios instance).
- Four async branches (loading/error/empty/data) on every async surface. A11y: visible focus, `aria-label` on icon buttons, Esc-closable focus-trapped modals, `prefers-reduced-motion` honored, color never the sole signal (§13.8).
- PIN UI is **4 digits** (matches mockup); surface the backend's weak-PIN / mismatch errors inline.
- New `useXxx` hooks live in `hooks/`; label/step constants in `constants/onboarding.ts`; prop/shape types in `types/onboarding.ts` (+ `types/index.ts` barrel).

---

## Phase F0 — lib layer (API clients + query hooks)

### Task F0.1: Auth API clients + hooks for OTP signup & verify

**Files:**
- Modify: `web/lib/api/auth.ts` (`submitSignup(email)`, `submitSignupVerify({email,otp,deviceFingerprint})`)
- Modify: `web/lib/query/auth.ts` (`useSignup`, `useSignupVerify`), `web/lib/query/keys.ts` if needed
- Test: co-located `.test.ts`

**Interfaces:**
- Produces: `useSignup()` → posts `SignupRequestSchema.parse({email})` to **`/auth/signup/request`** (NOT `/auth/signup` — the backend added additive OTP endpoints; the legacy link `/auth/signup` still exists but is deprecated), returns `LoginRequestResponse` `{status:'otp_sent', devOtp?}`; `useSignupVerify()` → posts `SignupVerifyRequestSchema` to **`/auth/signup/verify`**, returns `LoginVerifyResponse`, on success calls `setSession(accessToken, user)` (same as `useLoginVerify`). Device fingerprint from `lib/device.ts`.

- [ ] **Step 1: Write failing tests** — mock the Axios instance; assert `submitSignup` parses+posts email-only; `submitSignupVerify` posts otp+deviceFingerprint and stores the session.
- [ ] **Step 2: Run** `pnpm --filter @handshake-agent/web test auth` → FAIL.
- [ ] **Step 3: Implement** the clients + hooks (mirror the existing `submitLoginRequest`/`submitLoginVerify` + `useLoginVerify` pattern, incl. device fingerprint from `lib/device.ts`).
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(web): OTP signup + verify api clients/hooks`.

### Task F0.2: Set-name + Sumsub-token clients/hooks; extend `Me` type

**Files:**
- Create: `web/lib/api/kyc-onboarding.ts` (`submitName`, `fetchSumsubToken(level)`)
- Create: `web/lib/query/kyc-onboarding.ts` (`useSetName`, `useSumsubToken`)
- Modify: `web/types/` Me type (add `emailVerified`) — re-export from contracts
- Modify: `web/lib/query/kyc.ts` — ensure `useSetPin` posts to `/kyc/pin` (exists) and is reusable pre-KYC
- Test: co-located `.test.ts`

**Interfaces:**
- Produces: `useSetName()` → `POST /profile/name`; `useSumsubToken()` → `POST /kyc/sumsub/token {level}` → `{token}`; `useSetPin()` → `POST /kyc/pin {pin}` (reused).

- [ ] Steps: failing tests (parse+post shapes) → implement → PASS → commit `feat(web): set-name + sumsub-token + pin clients/hooks`.

---

## Phase F1 — the wizard (shared state machine + steps)

### Task F1.1: Wizard state machine + resume derivation

**Files:**
- Create: `web/hooks/use-onboarding-machine.ts` (step enum, transitions, resume-from-`me` derivation)
- Create: `web/constants/onboarding.ts` (step order, tracker labels, copy)
- Create: `web/types/onboarding.ts` + barrel export
- Test: `web/hooks/use-onboarding-machine.test.ts`

**Interfaces:**
- Produces: `OnboardingStep = 'welcome'|'email'|'otp'|'name'|'pin'|'kyc'|'sumsub'|'done'`; `useOnboardingMachine()` → `{ step, data, next, back, goto, restart }`; `deriveResumeStep(me): OnboardingStep` — `!session→welcome`; `session && !emailVerified→otp`; `!firstName→name`; `!hasPin→pin`; `hasPin→kyc` (or `done` if already tier_2+).

- [ ] **Step 1: Write failing tests** — transitions (email→otp→name→pin→kyc→done, back edges) and `deriveResumeStep` for each `me` shape.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): onboarding state machine + resume derivation`.

### Task F1.2: Shared step components

**Files (create under `web/components/onboarding/`; repurpose the existing unused `onboarding/` mockup files or replace them):**
- `WelcomeStep.tsx` · `EmailStep.tsx` · `OtpStep.tsx` · `NameStep.tsx` · `PinStep.tsx` · `KycChoiceStep.tsx` · `DoneStep.tsx`
- Test: co-located `.test.tsx` each

**Per-step spec (from the mockup — match copy, structure, states):**
- **Welcome:** amber logo tile (pulsing ring), "Let's set up your wallet." / "Money that moves at the speed of chat." on mobile, "Get started" CTA, "Already have an account? Log in" → `/login`.
- **Email:** "What's your email?" + mail-icon input; primary "Send code" enabled only when email valid; spinner "Sending code…"; calls `useSignup`; on success → `otp`.
- **Otp:** "Enter your code" + masked email + countdown (`use-countdown`, from `auth.otp.ttlSeconds`); **desktop** = 6 keyboard boxes w/ auto-advance + backspace-to-prev; **mobile** = 6 display cells filled by the on-screen `Keypad`; "Resend" (30s cooldown, `RESEND_COOLDOWN_SECONDS`); calls `useSignupVerify`; on success (session+tier_1) → `name`.
- **Name:** "What should we call you?" + person-icon input; "Continue" enabled when ≥2 chars; calls `useSetName`; → `pin`.
- **Pin:** "Set your transaction PIN" — **desktop** = create + confirm password inputs (letter-spaced), shake on mismatch; **mobile** = create screen (4 dots) → confirm screen (4 dots) via `Keypad`; inline error for mismatch AND backend weak-PIN rejection; calls `useSetPin`; → `kyc`.
- **KycChoice:** "You're in, {firstName}." + two cards: "Verify now" (amber-bordered, "BVN or NIN + a selfie · about 1 minute") → `sumsub`; "Explore first, verify later" → `done` (kycChoice='later').
- **Done:** success check (pulsing ring), "Welcome to Handshake, {firstName}.", ₦0.00 balance card + status badge (Verified/Unverified from `kycStatus`), agent-ready card, if skipped → amber "Verify to unlock sending & cash-out" banner (→ `sumsub`), "Open my wallet" → `/`.

- [ ] For each: **Step 1** failing RTL test (renders, validation gates the CTA, calls the right hook on submit) → **Step 2** FAIL → **Step 3** implement (tokens only, a11y, four branches where async) → **Step 4** PASS → **Step 5** commit `feat(web): onboarding <step> step`.

### Task F1.3: Mobile keypad + progress + desktop rail/tracker chrome

**Files:**
- Create: `web/components/onboarding/Keypad.tsx` (3×4 numeric grid, ⌫; drives otp/pin on mobile)
- Create: `web/components/onboarding/OnboardingProgress.tsx` (mobile 4-segment bar + back button)
- Create: `web/components/onboarding/OnboardingRail.tsx` (desktop dark-green rail: logo, headline, **vertical step-tracker** with done/active/pending states, encryption footer)
- Test: co-located

- [ ] Steps per component: failing test (keypad emits digits/backspace; tracker marks done/active from step) → implement → PASS → commit.

### Task F1.4: Wizard shell (desktop vs mobile composition)

**Files:**
- Create: `web/components/onboarding/OnboardingWizard.tsx` (chooses chrome by `use-is-desktop`, renders current step, wires machine ↔ steps)
- Test: `OnboardingWizard.test.tsx` (renders desktop rail on wide, mobile keypad on narrow; walks a full happy path with mocked hooks)

- [ ] Steps: failing test → implement → PASS → commit `feat(web): onboarding wizard shell (desktop rail / mobile keypad)`.

---

## Phase F2 — routes + gating

### Task F2.1: `/get-started` route + redirects

**Files:**
- Create: `web/app/get-started/page.tsx` (thin: renders `OnboardingWizard`; reads `me` for resume; public)
- Modify: `web/app/signup/page.tsx` + `web/app/onboarding/page.tsx` → redirect to `/get-started`
- Test: Playwright smoke (later phase)

- [ ] Steps: implement the route (orchestrator only per §16) + redirects → typecheck/lint → commit `feat(web): /get-started onboarding route + legacy redirects`.

### Task F2.2: Relax `RequireVerified` to admit tier_1

**Files:**
- Modify: `web/components/auth/RequireVerified.tsx`
- Test: `RequireVerified.test.tsx`

**Interfaces:**
- Produces: predicate — authenticated + `hasPin` + `kycTier !== 'unverified'` → render children (admit tier_1+); `!hasPin` OR `unverified` → redirect `/get-started`. Never bounces a tier_1 user with a PIN.

- [ ] **Step 1: Write failing tests** — tier_1 + hasPin → children; tier_1 + no PIN → `/get-started`; unverified → `/get-started`; tier_2 → children.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): admit tier_1 (email-verified) users into the app shell`.

### Task F2.3: Post-auth routing (login + signup-verify land in the app)

**Files:**
- Modify: `web/components/auth/login/login-verify-step.tsx` (route by state: `hasPin` → `/`; else `/get-started`)
- Modify: `OnboardingWizard` done → `/`
- Test: update the existing login-verify test

- [ ] Steps: failing test → implement → PASS → commit `fix(web): route verified/PIN'd users to the app, resumers to /get-started`.

---

## Phase F3 — Sumsub WebSDK

### Task F3.1: `SumsubVerification` component

**Files:**
- Add dep: `pnpm --filter @handshake-agent/web add @sumsub/websdk-react`
- Create: `web/components/kyc/SumsubVerification.tsx` (fetches token via `useSumsubToken(level)`; renders `<SumsubWebSdk>`; on `applicantSubmitted`/`applicantReviewed` → callback; four branches incl. token-fetch error)
- Test: `SumsubVerification.test.tsx` (mock the SDK; token fetched for the level; completion callback fires)

- [ ] Steps: failing test → implement (accessToken provider = `useSumsubToken`, expiration handler re-fetches) → PASS → commit `feat(web): Sumsub WebSDK verification component`.

### Task F3.2: Wire Sumsub into the three entry points

**Files:**
- Modify: `OnboardingWizard` `sumsub` step → `SumsubVerification level="tier_2"`; on submit → `done` (in-review state)
- Modify: `DoneStep` + mobile home "Verify to unlock" banner → open `SumsubVerification`
- Test: wizard test covers the verify-now branch

- [ ] Steps: failing test → implement → PASS → commit `feat(web): launch Sumsub from onboarding + done-screen banner`.

---

## Phase F4 — Settings resume + Login restyle

### Task F4.1: Settings "Verify your identity" section

**Files:**
- Create: `web/components/settings/VerificationSection.tsx` (shows current tier + what each rung unlocks; CTA launches `SumsubVerification` for the next rung: tier_1→tier_2 doc+liveness, tier_2→tier_3 proof-of-address; "in review" state when `kycStatus='pending_review'`)
- Modify: `web/components/settings/settings-panel.tsx` + `web/components/desktop/settings-page.tsx` (mount the section)
- Test: `VerificationSection.test.tsx` (tier_1 shows "Verify to unlock sending"; tier_2 shows "Increase limits (proof of address)"; tier_3 shows "Fully verified"; pending shows "in review")

- [ ] Steps: failing tests → implement (reads `me`/`profile`; polls `me` after submit) → PASS → commit `feat(web): Settings identity-verification / resume-KYC section`.

### Task F4.2: Restyle Login to the new aesthetic

**Files:**
- Modify: `web/app/login/page.tsx`, `web/components/auth/LoginForm.tsx` + `login/*` (apply the brand-rail / cream-card treatment; keep the email→OTP mechanic + tests)
- Test: existing login tests stay green; add a snapshot/structure assertion for the new shell

- [ ] Steps: keep behavior, restyle chrome → run login tests → PASS → commit `feat(web): restyle login to match onboarding`.

---

## Phase F5 — verification

### Task F5.1: Playwright onboarding pass (both viewports)

**Files:**
- Create: `web/e2e/onboarding.spec.ts` (desktop + mobile projects; uses dev OTP echo)

- [ ] **Step 1:** script welcome→email→otp(dev)→name→pin→"explore later"→app; assert landing + "Verify to unlock" banner. **Step 2:** run against the local api (`AUTH_DEV_EXPOSE_OTP=true`). **Step 3:** commit `test(web): playwright onboarding pass`.

### Task F5.2: Visual verification + gates

- [ ] Run `pnpm --filter @handshake-agent/web test`, `pnpm lint`, `pnpm typecheck`, `pnpm depcruise`.
- [ ] Visual-verify via the browser preview (`web/CLAUDE.md` runbook): desktop `/get-started` (rail + tracker, each step), mobile `/get-started` (keypad, PIN split, done), Settings verify section, restyled login. Screenshots for certification (dark-mode is N/A — app is `forcedTheme=light`).

---

## Self-review checklist

- Every mockup step (welcome/email/otp/name/pin/kyc-choice/kyc-now/done) → a Task F1.2 component. ✔
- Desktop rail+tracker (F1.3) and mobile keypad+progress (F1.3) both covered. ✔
- Sumsub 3 entry points: onboarding fork (F3.2), done/home banner (F3.2), Settings resume (F4.1). ✔
- Gating relaxation (F2.2) + post-auth routing (F2.3) + redirects (F2.1). ✔ Login restyle (F4.2). ✔
- No placeholders; each task is TDD + commit; FE shapes from contracts. ✔
- Layering (§4.2) + componentisation (§16): pages orchestrate, sections ≤150 lines, hooks/constants/types split. ✔
