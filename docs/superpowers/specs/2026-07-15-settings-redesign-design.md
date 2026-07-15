# Settings redesign — desktop + mobile, fully live (1:1 parity)

- **Date:** 2026-07-15
- **Branch:** `feat/settings-redesign` (off `feat/payid-internal-transfer` HEAD, which carries PayID + public nicknames)
- **Design sources (Claude Design project `99aef22a-9c3e-41f5-b3f4-c413ff34b477`):**
  - `Handshake Settings v2.dc.html` — desktop
  - `Handshake Settings Mobile.dc.html` — mobile
- **Goal:** Reproduce both designs with **1:1 parity** — colors, spacing, radii, font sizes/weights, **and element sizes** (button padding/radii, icon sizes, icon-container dimensions). Every value below is copied from the design HTML. Where the design shows data the backend does not expose, **build the backend** so the card is live (user decision).

---

## 1. Scope & decisions (locked)

1. **Build the missing backend** so the membership card is fully live: daily-transfer usage (used/limit), member-since, and a security-strength score — all from real signals. No fabricated numbers (funds app).
2. **Hide the desktop chat rail on Settings** so the page renders the standalone two-column passport layout at full width.
3. **Verify/upgrade CTA lives in the membership card** (shown only when below max tier `tier_3`), reusing the existing `SumsubVerificationDialog`.
4. **Exact element sizing** is a first-class requirement (per user): icon containers, icons, button paddings/radii all match the design.

Non-goals: no new WhatsApp surface, no privacy-toggle persistence (phone is masked by default), no session geolocation (not stored — we show parsed browser·OS instead).

---

## 2. Architecture overview

```
GET /profile  (extended, additive)
  └─ ProfileService.getProfile  → injects VELOCITY_REPOSITORY + CLOCK
       ├─ limits { …, dailyFiatUsed, dailyTxCountUsed }   ← getDailyUsage (same value the money-gate reads)
       ├─ memberSince (ISO)                                ← users.createdAt
       └─ security { score 0..4, label }                  ← hasPin + emailVerified + deviceBound + kyc≥tier_2

web SettingsPanel (density-aware orchestrator)
  desktop → radial bg → centered max-w-[1180px] → header + 2-col grid [MembershipCard 352px sticky | sections]
  mobile  → flex-col → app-bar (flex-none) + scroll body [MembershipCard compact | sections | log out]
  sections: AccountSection, SecuritySection, ConnectedAgentsSection, PreferencesSection
  shared: MembershipCard, Toast (new primitive)
```

The **model-proposes / engine-disposes** invariant is untouched: the new backend work is **read-only display** of the velocity counter the gate already maintains; enforcement in `KycGateService` is unchanged (§3.1/§3.3 preserved). The agent gets no new DB access (§3.2).

---

## 3. Backend changes

### 3.1 Contracts — `packages/contracts/src/dto/profile.dto.ts`

Extend additively (all consumers keep working):

```ts
// ProfileLimitsSchema — add live usage (present only when limits present, i.e. verified tier)
ProfileLimitsSchema = z.object({
  perTxFiatMax: z.number(),
  dailyFiatMax: z.number(),
  dailyTxCountMax: z.number(),
  dailyFiatUsed: z.number(),        // NEW — amount used in current 24h window
  dailyTxCountUsed: z.number(),     // NEW — tx count used in current 24h window
})

MembershipSecuritySchema = z.object({   // NEW
  score: z.number().int().min(0).max(4),
  label: z.enum(['weak', 'fair', 'good', 'strong']),
})

ProfileResponseSchema = z.object({
  …existing…,
  memberSince: z.string().nullable(),      // NEW — ISO users.createdAt
  security: MembershipSecuritySchema,       // NEW
})
```

Contract fixture tests (Vitest) parse valid/invalid usage + security shapes.

### 3.2 `ProfileService.getProfile` — `api/src/modules/identity/application/profile.service.ts`

- Inject `VELOCITY_REPOSITORY` (`getDailyUsage(userId, asOf, fiatCurrency)` → `{ fiatTotal: string, txCount: number }`) and `CLOCK`.
- After resolving `fiatCurrency` + `limits`, when `limits !== null` add `dailyFiatUsed = Number(usage.fiatTotal)`, `dailyTxCountUsed = usage.txCount`.
- `memberSince` from `createdAt` (add `createdAt` to `loadUser`'s select → `UserRecord`).
- `security`: pull `hasPin` + `emailVerified` from the me-projection (already injected `AuthService`/repo), `deviceBound = pinnedDeviceId != null` (add `pinnedDeviceId` to `loadUser` select), `kycVerified = kycTier ∈ {tier_2,tier_3}`. `score` = count of the four booleans; `label`: `4→strong, 3→good, 2→fair, ≤1→weak`.
- Mirror `AdminUserSecurityService.getLimits` for the usage read.

### 3.3 Repository — `api/src/modules/identity/{application/ports,infrastructure}`

Add `createdAt` + `pinnedDeviceId` to `loadUser`'s Prisma `select` and to the `UserRecord` port type. No schema migration (columns exist: `users.created_at`, `users.pinned_device_id`). No new table → prisma-schema table-count test unaffected.

### 3.4 Backend tests (TDD, red→green)

- `profile.service.spec.ts`: usage folded into limits; unverified → limits null & no usage; security score permutations (0–4 → labels); member-since passthrough; EffectiveConfigService override still flows.
- `profile.e2e-spec.ts` (real Postgres): `GET /profile` returns `limits.dailyFiatUsed`, `memberSince`, `security.{score,label}`; assert usage reflects a settled tx (or 0 when none).
- Money-path application-layer coverage bar (statements 82 / branches 36 / functions 72 / lines 82) respected.

---

## 4. Frontend token strategy (§5 compliance + exact color parity)

Reuse existing tokens (exact matches, confirmed): `--background` #f3efe7, `--primary` #1a4536, `--primary-deep` #0e241c, `--accent` #f5a623, `--accent-deep` #e8961a, `--card` #fff, `--card-muted` #fbfaf6, `--border` #ebe5d8, `--success` #1f8a5b, `--foreground` #16261e, `--font-sans` Figtree, `--font-mono` IBM Plex Mono.

Add **namespaced token blocks** to `web/app/globals.css` (hex lives once in the token layer → §5 satisfied; components use utilities). Expose via `@theme inline` as `--color-settings-*` / `--color-membership-*` so `bg-*`/`text-*`/`border-*` utilities resolve.

**`--settings-*` (light sections):**
| token | hex | use |
|---|---|---|
| `--settings-soft` | #8a9389 | sub-text, section labels |
| `--settings-faint` | #a7ad9f | uppercase muted, placeholder |
| `--settings-ink` | #2f3d34 | input/chip text |
| `--settings-ink-strong` | #25332b | Ask button text |
| `--settings-label` | #4a564d | docs labels, session icons |
| `--settings-btn-text` | #3d4a42 | row-button text |
| `--settings-btn-border` | #d7d1c4 | row-button/input border |
| `--settings-btn-hover` | #f2eee4 | row-button hover / chip bg |
| `--settings-line` | #e0dacd | section header rule |
| `--settings-hairline` | #f2ede2 | row border-top |
| `--settings-hairline-soft` | #f6f2e9 | session row border-top |
| `--settings-chip-border` | #e6e0d3 | chip / app-bar border |
| `--settings-outline` | #e2dccf | Ask / back-button border |
| `--settings-code-bg` | #f6f3ec | code box bg |
| `--settings-code-border` | #ece6d9 | code box border |
| `--settings-danger` | #c0392b | revoke/logout text |
| `--settings-danger-border` | #f0d3cf | danger button border |
| `--settings-danger-bg` | #fdf3f2 | danger button bg |
| `--settings-danger-hover` | #fbe7e5 | danger button hover |
| `--settings-dark` | #16261e | dark buttons (Create token / Add) — = foreground |
| `--settings-dark-hover` | #22382c | Create-token hover |
| `--settings-info` | #3763c4 | "This device" text |
| `--settings-info-bg` | #e9eefb | "This device" bg |
| `--settings-radial-a/b/c` | #f2efe6 / #e8e3d8 / #e1dccf | page radial-gradient stops |

**`--membership-*` (on-dark card):**
| token | hex/rgba | use |
|---|---|---|
| `--membership-sage` | 214 226 219 | sage-white base (used at .5–.62 via `/opacity`) |
| `--membership-mint` | #7fd6a3 | Security strong, tier ring text, shield |
| `--membership-mint-soft` | #a9e6c4 | Verified pill text |
| `--membership-mint-dim` | #c7ddcf | command text on dark |
| `--membership-mint-icon` | #8fb3a1 | copy icon on dark |
| `--membership-stripe-a/b` | #3a5c4d / #2c5142 | avatar stripes |
| `--membership-ink` | #0e241c | dark code box bg (= primary-deep) |

Whites use Tailwind opacity utilities (`bg-white/[.06]`, `text-white`, `border-white/10`). Amber glow / mint tints use `var(--accent)`/`var(--membership-mint)` with `/opacity`.

Radial page background applied on the settings surface (desktop `radial-gradient(1300px 800px at 15% -10%, …)`, mobile `radial-gradient(1100px 700px at 50% -12%, …)`).

---

## 5. Frontend component structure (§16 — orchestrator + sections)

New/updated files under `web/`:

- `components/settings/settings-panel.tsx` — **density-aware orchestrator**. Desktop: radial bg + `mx-auto max-w-[1180px] px-12 pt-10 pb-20` + header + `grid grid-cols-[352px_minmax(0,1fr)] gap-11 items-start`. Mobile: `flex h-full flex-col` → app-bar (flex-none) + `flex-1 overflow-y-auto` body (`flex flex-col gap-5 p-4 pb-6`).
- `components/settings/settings-header.tsx` — desktop header (brand chip + `Settings` h1 + Ask button) / mobile app-bar (back + title + Ask). Density prop.
- `components/settings/membership-card.tsx` — the passport card (§6). Consumes `useProfile()`; verify CTA via `useRefreshIdentity()` + `SumsubVerificationDialog` (shown when `nextLevel(kycTier) !== null`).
- `components/settings/account-section.tsx` — Name/Email (→ `EditProfileDialog`), PayID handle (→ claim/change existing flow), Public nicknames (inline add + chips, existing hooks). Reuses `useProfile`, `usePublicNicknames`, `useCreatePublicNickname`, `useDeletePublicNickname`, `useChangePayId`.
- `components/settings/security-section.tsx` — Transaction PIN (→ `ChangePinDialog`) + Active sessions (parsed `browser · OS` from `userAgent`, immediate revoke + toast; current session non-revocable). Reuses `useProfileSessions`, `useRevokeSession`, `useChangePin`.
- `components/settings/connected-agents-section.tsx` — PATs list/create(→`CreateTokenDialog`)/disconnect + MCP endpoint / auth header / Claude-Code snippet (`CopyButton`) + info note. Reuses `usePats`, `useCreatePat`, `useRevokePat`, `useMcpEndpoint`.
- `components/settings/preferences-section.tsx` — Language row: the real `LanguageSelector` restyled to the design's select pill (keeps full language list).
- `components/shared/toast.tsx` + `hooks/use-toast.ts` (or a tiny Zustand store in `lib/`) — **new Toast primitive**: dark pill, desktop `fixed bottom-[26px] left-1/2 -translate-x-1/2`, mobile `absolute bottom-24 left-1/2`. Feedback for copied / revoked / language-set / token-created / logout.
- `lib/format/phone.ts` — `maskPhone(phone)` → `+234 810 •••• 0007` (mask middle group). Unit-tested.
- `lib/settings/user-agent.ts` — `parseUserAgent(ua)` → `{ browser, os, isDesktop }` (best-effort; falls back to channel). Unit-tested.
- `constants/settings.ts` — add copy: agent row subtitle, MCP note, section labels, verify CTA reuse.
- `types/settings.ts` — new prop types (`MembershipCardProps`, `SettingsHeaderProps`, section props, `ToastProps`).

**Shell changes:**
- `components/desktop/dashboard-experience.tsx` — render `ChatRail` only when `dPage !== 'settings'`; keep sidebar.
- `components/mobile/mobile-shell.tsx` — settings branch renders the mobile app-bar (via SettingsPanel density=mobile, which itself renders flex-none app-bar). Back button → `onBack` prop switching to the chat tab.

Existing dialogs (`EditProfileDialog`, `ChangePinDialog`, `CreateTokenDialog`, PayID form) are **reused as-is**, wired to the new buttons. Removed as standalone sections (folded into new layout): `ProfileSection`, `PayIdSection`, `PublicNicknamesSection`, `VerificationSection`, `SecuritySection`(old), `McpSection`, `sessions-list.tsx`, `mcp-connection-docs.tsx` — their logic migrates into the new section components. Delete after migration; update/rewrite their tests.

---

## 6. Exact dimensions (the parity reference)

### 6.1 Desktop (`Settings v2`)

**Page:** radial bg `radial-gradient(1300px 800px at 15% -10%, #f2efe6, #e8e3d8 55%, #e1dccf)`; container `max-width:1180px; padding:40px 48px 80px; margin:0 auto`. (Drop the design's `min-width:920px` in-app to avoid horizontal scroll beside the 236px sidebar; two-col grid stacks below ~880px container width.)

**Header** (mb 36; flex, align flex-end, justify between, gap 24):
- Brand chip row (gap 9, mb 10): amber square 22×22 r7 (`linear-gradient(150deg,accent,accent-deep)`) + inner dot 8×8 r3 primary-deep; mono label 12/500/0.08em uppercase soft "Handshake · Account". h1 "Settings" 34/800/-0.03em foreground.
- Ask button: bg card, border 1px outline, r999, padding `7px 16px 7px 8px`, shadow `0 1px 2px rgba(22,38,30,.04)`, hover card-muted; circle 30×30 amber-gradient + sparkle svg 15×15 (primary-deep stroke 1.6); text 14/700 ink-strong "Ask the agent".

**Grid:** `352px minmax(0,1fr)` gap 44, align start.

**Membership card** — see §6.3. Sticky `top:32px`, r26, padding 26, shadow `0 24px 60px rgba(14,36,28,.32)`.

**Sections column:** flex-col gap 26. Section header (padding `0 4px 12px`, gap 14): label 11/700/0.11em uppercase soft + flex-1 hairline `--settings-line`. Card: bg card, border 1px border, r18, shadow `0 1px 2px rgba(22,38,30,.03)`, overflow hidden.

**Row (generic):** padding `16px 18px`, gap 14, border-top 1px hairline (except first). Icon container **38×38 r11 bg #f3efe7**, icon **18×18** (primary strokes 1.5) — PayID uses mono "@" 17/500 primary. Title 15/700 foreground; sub 13.5 soft mt 1. Row button: border 1px btn-border, bg card-muted, text 13/600 btn-text, padding `8px 14px`, r10, hover btn-hover.

**Account extras:** nickname chips (margin `13px 0 0 52px`, gap 8): mono 13, bg btn-hover, border 1px chip-border, text ink, padding `6px 8px 6px 12px`, r999; remove 18×18 circle bg outline text #6a776e "×". Add-input (margin `12px 0 0 52px`, max-w 400, gap 8): pill bg card-muted border 1px btn-border r11 padding `0 12px`, mono "@" faint 14 + input mono 14 ink padding `10px 4px`; "Add" btn bg dark text white 13/600 padding `10px 18px` r11.

**Security:** PIN row (lock icon). "Active sessions" subheader (padding `14px 18px 8px`, border-top hairline): label 12/700/0.04em uppercase faint; count 12.5 soft. Session row (padding `12px 18px`, border-top 1px hairline-soft, gap 14): icon 38×38 (desktop/mobile glyph, #4a564d); label 14.5/700 + "This device" pill 11/700 info / info-bg padding `2px 8px` r999; meta 12.5 soft mt 2. Revoke btn: border 1px danger-border, bg danger-bg, text danger 12.5/600, padding `7px 13px`, r10, hover danger-hover. Trailing spacer h8.

**Connected agents:** header adds Create-token btn (bg dark, white, 12.5/600, padding `8px 14px`, r10, hover dark-hover). Agent row (padding `15px 18px`, border-bottom 1px hairline): icon 38×38 r11 amber-gradient + robot svg 18×18 white; name 14.5/700; "Full read · prepare only · created {date}" 12.5 soft mt 2; Disconnect (danger like Revoke). Empty (padding `16px 18px`, border-bottom): icon 38×38 bg #f3efe7 robot soft; text 13.5 soft lh 1.55. Docs (padding `16px 18px`, gap 15): field label 12.5/700 label mb 6; endpoint box bg code-bg border 1px code-border r10 padding `11px 13px` mono 13 ink + CopyButton (copied → success 12/600); auth box mono 13 `Authorization: Bearer hsk_pat_••••••••`; dark box bg primary-deep r10 padding `12px 13px` mono 12.5/lh1.55 mint-dim + copy (mint-icon / mint "Copied ✓"); info note gap 9: info svg 15×15 + text 12.5 soft lh 1.55.

**Preferences:** Language row (globe icon); select styled: border 1px btn-border, bg card-muted, text 13.5/600 ink, padding `9px 34px 9px 13px`, r11, custom chevron right-12.

**Log out:** self-start; border 1px danger-border, bg card, text danger 14/700, padding `12px 20px`, r13, gap 9, hover danger-bg; power svg 16×16.

**Toast:** fixed `bottom:26px` center; bg dark, white 13.5/600, padding `12px 20px`, r12, shadow `0 12px 30px rgba(14,36,28,.28)`, `hsToast .22s`.

### 6.2 Mobile (`Settings Mobile`)

Outer radial `radial-gradient(1100px 700px at 50% -12%, …)`. App-bar (flex-none, padding `54px 18px 14px`, bg #f3efe7, border-bottom 1px chip-border, gap 12): back 38×38 r11 border 1px outline bg card + chevron 17×17 (#3d4a42 sw1.7); title "Settings" 19/800/-0.02em flex-1; Ask btn bg card border 1px outline r999 padding `5px 12px 5px 5px` gap 7 → circle 26×26 amber + sparkle 13×13 + "Ask" 12.5/700 ink-strong. Body padding `16px 16px 24px`, flex-col gap 20.

**Rows (mobile):** padding `14px 15px`, gap 12, flex-wrap; icon **34×34 r10 bg #f3efe7**, icon **17×17**; title 14.5/700; sub 13 soft; button `margin-left:auto` padding `7px 13px` r10 12.5/600. Chips (margin `12px 0 0 46px`) mono 12.5 padding `5px 8px 5px 11px`; remove 17×17. Add-input (margin `12px 0 0 46px`) pill r11 padding `0 11px`, input mono 14 padding `9px 4px`; Add btn padding `9px 16px` r11.
Sessions subheader padding `13px 15px 7px`; label 11.5; count 12. Session row padding `11px 15px` gap 12; icon 34×34; label 13.5/700 + "This device" 10/700 padding `2px 7px`; meta 12. Revoke 12/600 padding `6px 11px` r9.
Agents header "Agents · MCP"; Create btn 12/600 padding `7px 12px` r9. Agent row padding `13px 15px`; icon 34×34; name 13.5/700; "Prepare only · {date}" 12 soft. Disconnect 12/600 padding `6px 11px` r9. Empty text 13 lh1.5. Docs padding `14px 15px` gap 13; endpoint box padding `10px 12px` mono 12.5; dark box padding `11px 12px` mono 12; info svg 14×14 text 12 lh1.5.
Preferences select `margin-left:auto` padding `8px 32px 8px 12px` r11 13/600.
Log out: full width, padding 13, r14, gap 9, 14/700.
Toast: absolute `bottom:96px` center, bg dark white 12.5/600 padding `11px 18px` r12.

### 6.3 Membership card exact (desktop / mobile)

| element | desktop | mobile |
|---|---|---|
| card radius / padding / shadow | 26 / 26 / `0 24px 60px …/.32` | 22 / 20 / `0 16px 40px …/.3` |
| glow blob | top -90 right -70, 260×260 | top -70 right -60, 220×220 |
| "Membership" label | mono 11/500/0.14em | mono 10.5 |
| card svg | 30×24 | 28×22 |
| avatar circle | 60×60, ring `0 0 0 3px accent/.35` | 52×52 |
| name / phone | 19/800 / mono 13 | 18/800 / mono 12.5 |
| Verified pill | own row: "Verified · Tier 2" 12.5/700 padding `6px 12px` | inline right: "Tier 2" 11.5/700 padding `5px 10px`, check 11×11 |
| tier ring | 96×96 (r40 sw8 track white/.13, arc accent dash `167.5 251.3`) | 76×76 (r32 sw7 dash `134 201`) |
| ring center | "Tier" 10/600 · "2" 28/800 · "of 3" 10 | 9 · 22/800 · 9 |
| limit label / value | 12/600 · tnum 24/800/-0.02em | 11.5/600 · tnum 22/800 |
| usage bar | h7 r999 track white/.13, fill amber-gradient (used/limit %) | h6, mt9 |
| used caption | tnum 11.5 sage/.55 | tnum 11 |
| security icon box | 36×36 r10 bg white/.06 + shield 17×17 mint | no box, shield 17×17 direct, gap 11 |
| security label / value | "Security" 13.5/700 · "Strong" 12/700 mint | 12.5/700 · 11.5/700 |
| bars | 4× flex-1 h5 r3 (score filled mint, rest white/.16) | h5 |
| footer | "MEMBER SINCE {MON YYYY}" mono 11/.5 · "HSK · NG" mono 11 accent/.85 | (omitted) |

**Dynamic bindings:** ring arc = `kycTier`/3 (unverified 0 … tier_3 3); pill tone from `kycStatus`; limit = `formatFiat(limits.dailyFiatMax)`; usage bar % = `dailyFiatUsed/dailyFiatMax`; used caption = `formatFiat(dailyFiatUsed)`; security bars = `security.score`, label = `security.label`; footer country from `fiatCurrency` (NGN→NG), member-since from `memberSince`. Verify CTA (below `tier_3`) sits under the ring/pill area.

---

## 7. Parity-vs-truth handling

- **Phone** masked by default (`maskPhone`).
- **Sessions**: no geo → show `browser · OS` (parsed) + relative last-active + channel; current session shows "This device" and is non-revocable (matches design's `revocable = !current`).
- **Revoke session / disconnect agent**: immediate + toast (matches design; both are security-positive, current session can't be revoked). Destructive-confirm dialog dropped for these (was `ConfirmRevokeDialog`).
- **Language**: real `LanguageSelector` (full list) restyled to the design's pill — not limited to the 5 mockup options.
- **Edit/Change/Create/Claim**: open the existing real dialogs.

---

## 8. Testing & verification

- **Backend:** TDD unit (`profile.service.spec.ts`) + e2e (`profile.e2e-spec.ts`); coverage bar respected; run the identity e2e locally.
- **Contracts:** fixture parse tests for new shapes.
- **Frontend:** Vitest + RTL per existing recipe (mock query hooks; stub `SumsubVerification`). New tests for `membership-card`, each section, `toast`, `maskPhone`, `parseUserAgent`, and updated `settings-panel` / shell tests.
- **Gates:** `pnpm lint && pnpm typecheck && pnpm test` green; `pnpm depcruise` clean.
- **Visual verification (mandatory):** api :3001 + web :3000, log in as `qa.fulltest@example.com` (tier_1); screenshot desktop and mobile, compare side-by-side to both design files; console + network clean. Note: a tier_1 test user shows the verify CTA + null/limited limits — verify both a verified and unverified state where feasible.

---

## 9. Implementation sequence

1. Contracts (profile DTO) + fixture tests.
2. Backend `ProfileService` + repo select + unit + e2e (green before FE).
3. `web` tokens (globals.css) + `Toast` primitive + `maskPhone` + `parseUserAgent` (+ tests).
4. `MembershipCard` (+ verify CTA) + test.
5. Sections: Account, Security, Connected agents, Preferences (+ tests), reusing existing dialogs.
6. `SettingsPanel` orchestrator (desktop + mobile) + header/app-bar; delete migrated sections.
7. Shell wiring: hide desktop chat rail on settings; mobile app-bar back → chat tab.
8. Full gates + visual verification (desktop + mobile) against both designs.
