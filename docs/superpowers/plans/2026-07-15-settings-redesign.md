# Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce the desktop + mobile Settings designs at 1:1 parity (colors, spacing, radii, font sizes, and element sizes), with the membership card fully live via a small additive backend extension.

**Architecture:** Extend `GET /profile` additively (daily usage + member-since + security score, all read-only). Rebuild the web Settings surface as a density-aware orchestrator (`SettingsPanel`) with a passport `MembershipCard` + grouped sections, using existing brand tokens plus namespaced `--settings-*`/`--membership-*` tokens for the handful of bespoke colors. Reuse existing dialogs/hooks; add a small Toast primitive.

**Tech Stack:** NestJS 11 + Prisma 7 (api), Zod contracts, Next 16 + React 19 + Tailwind v4 + shadcn (web), Vitest/RTL (web tests), Jest + supertest/Testcontainers (api tests).

**Reference:** All exact pixel dimensions live in `docs/superpowers/specs/2026-07-15-settings-redesign-design.md` §6 (do not re-derive; copy from there). The two design files are in Claude Design project `99aef22a-9c3e-41f5-b3f4-c413ff34b477`.

## Global Constraints

- **§3.1 model-proposes/engine-disposes:** backend change is read-only display of the velocity counter; `KycGateService` enforcement is UNCHANGED. No LLM/agent path touched.
- **§3.2 agent no DB:** no changes in `agent/`; `dependency-cruiser` must stay clean.
- **§5 tokens only, no color hex in components:** bespoke colors go in `globals.css` token layer; components use `bg-*/text-*/border-*` utilities. Pixel spacing/radii/font-size arbitrary `[Npx]` allowed.
- **§16 componentisation:** page/panel orchestrates; sections in `components/settings/`; hooks in `hooks/`; constants in `constants/`; types in `types/<feature>.ts` + `@/types` barrel; no raw `<table>`; Money via `formatFiat`.
- **Fonts:** Figtree (`font-sans`), IBM Plex Mono (`font-mono`, `.mono`/`translate="no"` for handles/commands).
- **TDD:** red → green → refactor, frequent commits. Web tests mock query hooks (no real QueryClient). api money-path application coverage bar: statements 82 / branches 36 / functions 72 / lines 82.
- **Reuse (do not fork):** `Button`, `CopyButton`, `LanguageSelector`, `EditProfileDialog`, `ChangePinDialog`, `CreateTokenDialog`, `SumsubVerificationDialog`, PayID claim/change flow, `useProfile/usePublicNicknames/useProfileSessions/usePats/useChangePin/useLogout/useRefreshIdentity/useMcpEndpoint`.

---

## Phase A — Backend (contracts + profile, live membership data)

### Task A1: Extend profile contract (usage + memberSince + security)

**Files:**
- Modify: `packages/contracts/src/dto/profile.dto.ts`
- Test: `packages/contracts/src/dto/profile.dto.test.ts` (create if absent; else extend)

**Interfaces:**
- Produces: `ProfileLimitsSchema` (+`dailyFiatUsed:number`, `dailyTxCountUsed:number`), `MembershipSecuritySchema` (`{score:0..4, label:'weak'|'fair'|'good'|'strong'}`), `ProfileResponseSchema` (+`memberSince:string|null`, `security:MembershipSecuritySchema`). Types `ProfileLimits`, `MembershipSecurity`, `ProfileResponse` via `z.infer`.

- [ ] **Step 1: Write failing fixture test** — parse a valid profile object incl. `limits.dailyFiatUsed=320000`, `limits.dailyTxCountUsed=3`, `memberSince` ISO, `security:{score:4,label:'strong'}`; and reject `security.score=5` / `label:'x'`.
- [ ] **Step 2: Run** `cd packages/contracts && pnpm test profile.dto` — expect FAIL (fields unknown/strict or type missing).
- [ ] **Step 3: Implement** — add the two `.number()` fields to `ProfileLimitsSchema`; add `MembershipSecuritySchema`; add `memberSince: z.string().nullable()` and `security: MembershipSecuritySchema` to `ProfileResponseSchema`; export inferred types.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Commit** `feat(contracts): add live usage + memberSince + security to profile response`.

### Task A2: Add createdAt + pinnedDeviceId to loadUser projection

**Files:**
- Modify: `api/src/modules/identity/application/ports/identity.repository.port.ts` (`UserRecord` += `createdAt: Date`, `pinnedDeviceId: string | null`)
- Modify: `api/src/modules/identity/infrastructure/identity.prisma.repository.ts` (`loadUser` select += `createdAt: true, pinnedDeviceId: true`; map into record)
- Test: `api/test/profile.e2e-spec.ts` covers via A4; add a repo assertion only if a `*.repository` spec exists.

**Interfaces:**
- Produces: `UserRecord.createdAt: Date`, `UserRecord.pinnedDeviceId: string | null` consumed by A3.

- [ ] **Step 1:** Extend the `UserRecord` type (port) with the two fields.
- [ ] **Step 2:** Add `createdAt: true, pinnedDeviceId: true` to the `loadUser` Prisma `select` and thread into the returned record object.
- [ ] **Step 3: Run** `cd api && pnpm exec tsc -p tsconfig.json --noEmit` — expect no type errors from these files (consumers updated in A3).
- [ ] **Step 4: Commit** `feat(api): select createdAt + pinnedDeviceId in loadUser projection`.

### Task A3: ProfileService — usage + memberSince + security (unit TDD)

**Files:**
- Modify: `api/src/modules/identity/application/profile.service.ts`
- Test: `api/src/modules/identity/application/profile.service.spec.ts`

**Interfaces:**
- Consumes: `VELOCITY_REPOSITORY.getDailyUsage(userId, asOf, fiatCurrency) → {fiatTotal:string, txCount:number}`; `CLOCK.now()`; `UserRecord.{createdAt,pinnedDeviceId}` (A2); me-projection `{hasPin, emailVerified}`.
- Produces: `getProfile` returns `limits` with `dailyFiatUsed/dailyTxCountUsed` (when limits ≠ null), `memberSince` (ISO), `security {score,label}`.

- [ ] **Step 1: Write failing tests** in the spec:
  - verified tier folds usage into limits: mock `getDailyUsage → {fiatTotal:'320000', txCount:3}` ⇒ `limits.dailyFiatUsed===320000 && limits.dailyTxCountUsed===3`.
  - unverified tier ⇒ `limits===null` and `getDailyUsage` NOT called.
  - `memberSince === user.createdAt.toISOString()`.
  - security permutations: all four true ⇒ `{score:4,label:'strong'}`; three ⇒ `good`; two ⇒ `fair`; one/zero ⇒ `weak`. (booleans: `hasPin`, `emailVerified`, `pinnedDeviceId!=null`, `kycTier∈{tier_2,tier_3}`.)
- [ ] **Step 2: Run** `cd api && pnpm exec jest profile.service --silent` — expect FAIL.
- [ ] **Step 3: Implement** — inject `@Inject(VELOCITY_REPOSITORY)` + `@Inject(CLOCK)`. After computing `fiatCurrency` + `limits`, when `limits` present call `getDailyUsage(userId, this.clock.now(), fiatCurrency)` and set the two used fields (`Number(fiatTotal)`, `txCount`). Compute `memberSince = user.createdAt.toISOString()`. Compute `security` via a private `computeSecurity({hasPin,emailVerified,deviceBound,kycVerified})` → `{score, label}` (label map: `>=4 strong, 3 good, 2 fair, else weak`). Source `hasPin`/`emailVerified` from the me-projection already available to the service.
- [ ] **Step 4: Run** the spec — expect PASS. Then `pnpm exec jest profile.service --coverage --collectCoverageFrom='src/modules/identity/application/profile.service.ts'` and confirm ≥ the application bar.
- [ ] **Step 5: Commit** `feat(api): expose live daily usage, memberSince, security score on /profile`.

### Task A4: /profile e2e (real Postgres)

**Files:**
- Modify: `api/test/profile.e2e-spec.ts`

- [ ] **Step 1: Write failing e2e** — authenticated `GET /profile` asserts `body.security.score` is 0..4 and `body.security.label` a valid enum, `body.memberSince` is an ISO string, and (verified fixture user) `body.limits.dailyFiatUsed` is a number ≥ 0 (0 when no tx settled).
- [ ] **Step 2: Run** `cd api && pnpm test:e2e -- profile.e2e` (Testcontainers; needs Docker + Redis) — expect FAIL then, after A3 merged in worktree, PASS.
- [ ] **Step 3:** If a settled-tx helper exists, add a case asserting `dailyFiatUsed` reflects it; else assert 0 and note.
- [ ] **Step 4: Commit** `test(api): e2e for live profile usage/security/memberSince`.

---

## Phase B — Web foundation (tokens, primitives, helpers)

### Task B1: Design tokens in globals.css

**Files:**
- Modify: `web/app/globals.css` — add `--settings-*` + `--membership-*` to `:root` (values from spec §4 tables) and expose as `--color-settings-*` / `--color-membership-*` in the `@theme inline` block; add `--radial-settings-desktop` / `--radial-settings-mobile` gradient vars.
- Test: none (CSS). Validated by build + visual.

- [ ] **Step 1:** Add the raw vars (exact hex from spec §4). Sage base as space-separated RGB for `/opacity`. 
- [ ] **Step 2:** Add matching `--color-settings-*` / `--color-membership-*` entries in `@theme inline` so `text-settings-soft`, `border-settings-line`, `bg-membership-mint`, etc. resolve.
- [ ] **Step 3: Run** `cd web && pnpm build` (or `pnpm typecheck` + a quick dev render) — expect no CSS errors.
- [ ] **Step 4: Commit** `feat(web): settings + membership design tokens`.

### Task B2: `maskPhone` helper (TDD)

**Files:** Create `web/lib/format/phone.ts`; Test `web/lib/format/phone.test.ts`.

**Interfaces:** Produces `maskPhone(phone: string | null | undefined): string` → e.g. `"+234 810 000 0007"` → `"+234 810 •••• 0007"`; null/short → `"—"` or graceful passthrough.

- [ ] **Step 1: Write failing tests** for a full NG number, an already-spaced number, a null, and a short/atypical number.
- [ ] **Step 2: Run** `cd web && pnpm exec vitest run lib/format/phone.test.ts` — FAIL.
- [ ] **Step 3: Implement** — normalize digits, keep country + first group + last 4, mask the middle group with `••••`.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(web): maskPhone helper`.

### Task B3: `parseUserAgent` helper (TDD)

**Files:** Create `web/lib/settings/user-agent.ts`; Test `web/lib/settings/user-agent.test.ts`.

**Interfaces:** Produces `parseUserAgent(ua: string | null): { browser: string; os: string; isDesktop: boolean }`. Falls back to `{browser:'Unknown', os:'', isDesktop:true}`.

- [ ] **Step 1: Write failing tests** — Chrome/macOS, Safari/iPhone (→ isDesktop:false), Firefox/Windows, null.
- [ ] **Step 2: Run** vitest — FAIL. **Step 3: Implement** simple UA regex detection. **Step 4: Run** — PASS. **Step 5: Commit** `feat(web): parseUserAgent helper`.

### Task B4: Toast primitive (TDD)

**Files:**
- Create: `web/lib/stores/toast-store.ts` (tiny Zustand: `{ message: string | null, show(msg), clear() }`, auto-clear via timeout in the hook).
- Create: `web/components/shared/toast.tsx` (`Toast` viewport: dark pill, `density` prop for desktop `fixed bottom-[26px]` / mobile `absolute bottom-24`; sizes per spec §6.1/§6.2; `role="status"`, `translate="no"` off).
- Create: `web/hooks/use-toast.ts` (returns `showToast(msg)`).
- Add to `web/components/shared/index.ts` barrel; types in `web/types/settings.ts`.
- Test: `web/components/shared/toast.test.tsx`.

**Interfaces:** Produces `useToast() → { showToast(msg:string):void }` and `<Toast density?='desktop'|'mobile' />`. Consumed by sections + orchestrator.

- [ ] **Step 1: Write failing test** — render `<Toast />`, call store `.show('Copied')`, assert the text appears with `role="status"`; assert empty renders nothing.
- [ ] **Step 2: Run** vitest — FAIL. **Step 3: Implement** store + component + hook (auto-clear ~2.6s). **Step 4: Run** — PASS. **Step 5: Commit** `feat(web): Toast primitive + store`.

---

## Phase C — Membership card

### Task C1: MembershipCard (TDD + exact dims)

**Files:**
- Create: `web/components/settings/membership-card.tsx`
- Types: add `MembershipCardProps { density }` to `web/types/settings.ts`
- Constants: add footer/label copy to `web/constants/settings.ts`
- Test: `web/components/settings/membership-card.test.tsx`

**Interfaces:**
- Consumes: `useProfile()` (`fullName`, `phone`, `kycTier`, `kycStatus`, `fiatCurrency`, `limits{dailyFiatMax,dailyFiatUsed}`, `memberSince`, `security{score,label}`), `useRefreshIdentity()`, `SumsubVerificationDialog`, `nextLevel(kycTier)` (import/replicate from VerificationSection), `maskPhone`, `formatFiat`, `tierLabel`.
- Produces: `<MembershipCard density />` used by SettingsPanel.

- [ ] **Step 1: Write failing tests** (mock `useProfile`, `useRefreshIdentity`; stub `SumsubVerification`): renders masked phone, `tierLabel`, daily-limit `formatFiat`, security label + `score` filled bars (assert count), member-since; ring arc proportional to tier; verify CTA present when `kycTier==='tier_1'` and opens dialog with `level='tier_2'`; CTA absent when `tier_3`.
- [ ] **Step 2: Run** vitest — FAIL.
- [ ] **Step 3: Implement** the card per spec §6.3 exact dims (desktop vs mobile via `density`). Colors via tokens (`bg-primary`→`bg-primary-deep` gradient, `text-membership-*`, `text-white/[.62]` for sage where a raw white works, amber via `bg-accent`). Ring: inline SVG with `stroke-dasharray` computed from tier/3 × circumference; bars: 4 divs, first `score` = `bg-membership-mint`, rest `bg-white/[.16]`. Usage bar width = `dailyFiatUsed/dailyFiatMax`. Verify CTA (below `tier_3`) opens `SumsubVerificationDialog`.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(web): membership passport card`.

---

## Phase D — Sections (reuse hooks + existing dialogs)

> Each section is a self-contained card matching spec §6.1 (desktop) and §6.2 (mobile) via a `density` prop. Row helper markup (icon container 38/34, icon 18/17, row button paddings) is shared — extract a small `SettingRow`/`SectionCard` local helper in the first section built and reuse.

### Task D1: SectionCard + SettingRow shared primitives (TDD)

**Files:** Create `web/components/settings/section-card.tsx` (`SectionCard` = header label + optional action + card body; `SettingRow` = icon-box + title/sub + trailing slot). Types in `web/types/settings.ts`. Test `web/components/settings/section-card.test.tsx`.

- [ ] Test renders label + children + action; row renders icon slot, title, sub, trailing. Implement per §6 dims (`density`). Commit `feat(web): settings SectionCard + SettingRow primitives`.

### Task D2: AccountSection (TDD)

**Files:** Create `web/components/settings/account-section.tsx`; Test `account-section.test.tsx`.

**Interfaces:** Consumes `useProfile`, `usePublicNicknames`, `useCreatePublicNickname`, `useDeletePublicNickname`, `useChangePayId`, `EditProfileDialog`, existing PayID claim flow, `useToast`.

- [ ] Tests: Name/Email rows show profile data + Edit opens `EditProfileDialog`; PayID row shows handle or "Not yet claimed" + Claim opens the claim flow; nicknames render as chips, add-input commits via `useCreatePublicNickname`, remove calls delete. Implement per §6 (rows, chips, add-input exact dims). Commit `feat(web): settings account section`.

### Task D3: SecuritySection (TDD)

**Files:** Create `web/components/settings/security-section.tsx`; Test `security-section.test.tsx`.

**Interfaces:** Consumes `useProfileSessions`, `useRevokeSession`, `useChangePin`, `ChangePinDialog`, `parseUserAgent`, `useToast`.

- [ ] Tests: PIN row Change opens `ChangePinDialog`; sessions list renders parsed `browser · OS`, "This device" pill on current + no Revoke; Revoke on others calls `useRevokeSession` + shows toast; loading/error/empty branches. Implement per §6 (subheader, session rows, revoke button dims). Commit `feat(web): settings security section`.

### Task D4: ConnectedAgentsSection (TDD)

**Files:** Create `web/components/settings/connected-agents-section.tsx`; Test `connected-agents-section.test.tsx`.

**Interfaces:** Consumes `usePats`, `useCreatePat`(via `CreateTokenDialog`), `useRevokePat`, `useMcpEndpoint`, `claudeMcpAddCommand`, `CopyButton`, `useToast`.

- [ ] Tests: Create-token opens `CreateTokenDialog`; agent rows render label + "Full read · prepare only · created {date}" + Disconnect calls `useRevokePat` + toast; empty state text; docs block shows endpoint/auth/command via `CopyButton`; info note. Implement per §6 (agent row, empty, docs block, dark command box dims). Commit `feat(web): settings connected-agents section`.

### Task D5: PreferencesSection (TDD)

**Files:** Create `web/components/settings/preferences-section.tsx`; Test `preferences-section.test.tsx`.

**Interfaces:** Consumes `LanguageSelector` (restyled to the design's select pill) or `useTranslation` directly + a styled `NativeSelect`. Keep full language list.

- [ ] Tests: language row renders; changing language calls `setLanguage` + toast. Implement per §6 (row + select pill dims). Commit `feat(web): settings preferences section`.

---

## Phase E — Orchestrator + header + shell wiring

### Task E1: SettingsHeader (desktop header + mobile app-bar) (TDD)

**Files:** Create `web/components/settings/settings-header.tsx`; Test `settings-header.test.tsx`. Types `SettingsHeaderProps { density; onBack?; onAsk? }`.

- [ ] Tests: desktop renders brand chip + "Settings" + "Ask the agent"; mobile renders back button (calls `onBack`) + "Settings" + "Ask". Implement per §6.1 header / §6.2 app-bar exact dims. Commit `feat(web): settings header + mobile app-bar`.

### Task E2: SettingsPanel orchestrator rebuild (TDD)

**Files:** Modify `web/components/settings/settings-panel.tsx`; Modify `web/components/settings/settings-panel.test.tsx`; add `<Toast>` mount. Delete migrated files (profile-section, payid-section, public-nicknames-section, VerificationSection, security-section[old], sessions-list, mcp-section, mcp-connection-docs) and their tests after wiring.

- [ ] **Step 1:** Rewrite the panel: `density==='desktop'` → radial bg + `mx-auto max-w-[1180px] px-12 pt-10 pb-20` + `SettingsHeader` + `grid grid-cols-[352px_minmax(0,1fr)] gap-11 items-start` (left `MembershipCard` sticky, right sections + log-out). `density==='mobile'` → `flex h-full flex-col` + `SettingsHeader` (flex-none) + `flex-1 overflow-y-auto` body (`flex flex-col gap-5 p-4 pb-6`: MembershipCard, sections, log-out). Log-out uses `useLogout` → `router.push('/login')` + toast. Mount `<Toast density={density}/>`.
- [ ] **Step 2:** Update the panel test to assert sections render + log-out wired; delete obsolete section files + tests.
- [ ] **Step 3: Run** `cd web && pnpm exec vitest run components/settings` — PASS.
- [ ] **Step 4: Commit** `feat(web): rebuild SettingsPanel to the passport layout`.

### Task E3: Desktop shell — hide chat rail on Settings

**Files:** Modify `web/components/desktop/dashboard-experience.tsx`; Modify `web/components/desktop/dashboard-experience.test.tsx`.

- [ ] **Step 1: Failing test** — when `dPage==='settings'`, `ChatRail` is not rendered (query by its test id / aria); rendered otherwise.
- [ ] **Step 2:** Wrap `<ChatRail .../>` in `{dPage !== 'settings' && ( … )}`.
- [ ] **Step 3: Run** the shell test — PASS.
- [ ] **Step 4: Commit** `feat(web): full-width Settings — hide chat rail on settings page`.

### Task E4: Mobile shell — settings app-bar back nav

**Files:** Modify `web/components/mobile/mobile-shell.tsx`; Modify test.

- [ ] **Step 1: Failing test** — settings tab renders SettingsPanel; the app-bar back action switches `tab` to `'chat'`.
- [ ] **Step 2:** Pass `onBack={() => setTab('chat')}` down to the panel/header for `density='mobile'` (thread an optional prop through `SettingsPanel`).
- [ ] **Step 3: Run** — PASS. **Step 4: Commit** `feat(web): mobile settings app-bar back navigation`.

---

## Phase F — Gates + visual verification

### Task F1: Full gates

- [ ] `pnpm --filter @handshake-agent/contracts test` · `pnpm --filter @handshake-agent/web lint typecheck test` · `pnpm --filter @handshake-agent/api lint typecheck` · `pnpm depcruise` — all green. Fix drift. Commit any fixups.

### Task F2: Visual verification (desktop + mobile)

- [ ] Start api `PORT=3001 pnpm --filter @handshake-agent/api dev` (Docker db :5544 + redis :6379 up); start web via preview `web` :3000; log in as `qa.fulltest@example.com` (email-OTP, dev-exposed).
- [ ] Desktop (≥1280 viewport): screenshot Settings; compare to `Handshake Settings v2` — header, sticky membership card (ring/limit/usage/security/verify CTA), all four sections, log-out, toast. Chat rail hidden. Console + network clean.
- [ ] Mobile (390×844): screenshot Settings; compare to `Handshake Settings Mobile` — app-bar, compact card, sections, log-out, bottom tabbar, toast.
- [ ] Fix any parity gaps (spacing/size/color), re-screenshot. Commit fixes.

### Task F3: Finish

- [ ] `superpowers:requesting-code-review` (or `/code-review`) on the branch; address findings.
- [ ] Update memory (settings-redesign entry). Offer PR via `superpowers:finishing-a-development-branch`.

---

## Self-review notes

- **Spec coverage:** A1–A4 cover §3 (backend); B1 covers §4 (tokens); B2/B3/B4 + C1 + D1–D5 + E1–E2 cover §5/§6 (FE structure + exact dims); E3/E4 cover shell (§5 shell changes); §7 truth handling realized in C1/D3/D5; §8 testing in every task + F1/F2.
- **Type consistency:** `security {score,label}`, `limits.dailyFiatUsed/dailyTxCountUsed`, `memberSince`, `maskPhone`, `parseUserAgent{browser,os,isDesktop}`, `useToast().showToast`, `nextLevel(kycTier)`, `MembershipCardProps/SettingsHeaderProps` are referenced consistently across tasks.
- **No placeholders:** logic-bearing code is described concretely; component pixel values are delegated to spec §6 tables (single source of truth) — intentional DRY, not a placeholder.
