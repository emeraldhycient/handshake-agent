# Componentisation & Modularisation of `web` and `web-admin`

**Date:** 2026-07-06
**Status:** Approved (brainstorm) — pending implementation plans
**Branch (foundation):** `refactor/modularisation-foundation`

---

## 1. Problem

Across `web` and `web-admin`, many pages and components have grown into large multi-section
files that mix orchestration, presentational markup, business constants, inline hooks, and
inline types. Concretely:

- **Oversized files** (over the §13 300-line soft cap): **12 in `web`**, **35 in `web-admin`**.
  Worst offenders: `web-admin/components/admin/user-detail.tsx` (2,167), `web-admin/lib/query/hooks.ts`
  (1,806), `web-admin/types/components.ts` (1,483), `web-admin/components/admin/transaction-detail.tsx`
  (1,094), `web/lib/store/chat-store.ts` (1,241), `web/types/components.ts` (478).
- **Ad-hoc tables.** `web` has **no `Table` primitive**; `web-admin` has one (`components/ui/table.tsx`)
  but two files still hand-roll `<table>`. The `overview-page.tsx` "Recent activity" section is a
  div grid; its "Assets" section is a raw `<table>`. Tabular data is not rendered through a canonical
  primitive.
- **Scattered constants.** No `constants/` folder in either app. Magic arrays (e.g. `HERO_ACTIONS`),
  status/tone maps, nav item lists, and column definitions live inline in components.
- **Monolithic types.** Types are centralized but into single 478 / 1,483-line `types/components.ts`
  files that are themselves too large and mix every feature's shapes together.
- **Inline hooks.** A few `useXxx` are defined inside component files
  (`dashboard-experience.tsx`, `mobile-shell.tsx`, `translation-provider.tsx`,
  admin `use-operator-alerts.ts`) rather than in a hooks folder.
- **Pages that aren't pages.** In `web`, `overview-page.tsx`, `wallet-page.tsx`, `activity-page.tsx`,
  `tickets-page.tsx`, `settings-page.tsx` are named "pages" but are **client-switched sub-views**
  inside a single route, not Next.js routes.

This violates the repo's own standards: §4.2 (strict downward layering, pages compose), §13.1
(one canonical primitive per concept), §13.2 (DRY), §13.3 (KISS size caps), §13.4 (types centralized).

## 2. Goals

1. Every page/route file is a **thin orchestrator**: data hooks + the four async branches
   (loading / error / empty / data) + composition of section components. No large inline markup.
2. Every reusable UI block is a **small, single-purpose component** (≤150 lines) in `components/`.
3. **Tabular data** renders through a canonical `Table` primitive via a `shared/DataTable`.
   No raw `<table>` or div-grid tables.
4. **Hooks, constants, and types** each live in their own centralized folder, never inline in a
   component.
5. In `web`, the desktop/mobile sub-views become **real Next.js routes** with a persistent
   responsive layout (the routing model the user chose).
6. Standards are written into `CLAUDE.md` (root + `web` + `web-admin`) so future agents preserve them.
7. **Behavior and pixels are preserved** everywhere except the deliberate `web` route-promotion
   (new URLs + browser history), which is explicitly in scope.

## 3. Non-goals

- No visual redesign. No new features. No copy changes.
- No backend/`api` changes. No contract-schema changes except where a type genuinely belongs in
  `@handshake-agent/contracts` (surface as drift; do not fold in unless trivial and in-scope).
- No cross-app shared UI package. Each app keeps its own `components/ui` (§13.1: one canonical
  primitive **per app**).
- No change to `web-admin` routing — it already uses proper Next routes.

## 4. Current state (verified 2026-07-06)

- `web` routes (real Next pages): `/`, `/dashboard`, `/app`, `/login`, `/signup`, `/kyc`,
  `/onboarding`, `/verify-email`, `/download`, `/offline`.
- `web` desktop shell: `DashboardExperience` — `useState<DashboardPage>` switches
  overview/wallet/activity/tickets/settings; sidebar + topbar + persistent `ChatRail` (chat surface `"d"`).
- `web` mobile shell: `MobileShell` — `useState<MobileTabId>` switches chat/wallet/activity/settings;
  `MobileTabbar` + confirm/pin/success overlays (chat surface `"m"`).
- `web` `/` root: `AdaptiveExperience` picks desktop vs mobile by `useIsDesktop`.
- View-set divergence: shared = wallet/activity/settings; desktop-only = overview, tickets;
  mobile-only = chat (desktop shows chat as an always-on rail).
- `web-admin`: 39 routes, each `app/<x>/page.tsx` → `<AppShell><XPage/></AppShell>`. `AppShell`
  centrally enforces auth + route permission. Componentisation-only.
- Types imported as `@/types/components` at **127 call-sites** across both apps.
- No `dependency-cruiser` rule keys off `hooks/` or `lib/hooks/`, so folder standardization is safe.

## 5. Target architecture (both apps)

```
app/<route>/page.tsx     # Next page = orchestrator: hooks + 4 async branches + composes sections
components/
  ui/                    # canonical primitives — one per concept (Table added to web)
  shared/                # cross-cutting composed pieces (Money, StatusPill, query-states, DataTable)
  <feature>/             # reusable sections/pieces, each one job, ≤150 lines
hooks/                   # ALL reusable hooks (web-admin lib/hooks/ promoted to hooks/ for parity)
constants/               # NEW — every magic array / label-map / column-def, grouped per feature
types/                   # per-feature files + index.ts barrel; imports use @/types
lib/                     # api / query / store / schemas / format (unchanged layering)
```

Import direction unchanged and still enforced by `dependency-cruiser`:
`app → components → lib → types`; `hooks` and `constants` sit alongside `lib` (importable by
`components`/`app`, never importing from `components`/`app`).

### 5.1 `Table` primitive + `shared/DataTable`

- Add `web/components/ui/table.tsx` mirroring `web-admin/components/ui/table.tsx` (shadcn, style
  `radix-vega`): `Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption`.
- Add `shared/DataTable` in **both** apps: a column-config-driven table
  (`columns: { key, header, align?, width?, render(row) }[]`, `rows`, `getRowKey`, `empty`, optional
  `caption`) that renders through the `Table` primitive and owns the loading/empty branches for a
  list. Feature tables (Assets, Recent activity, admin lists) become thin column-config wrappers.
- Accessibility: `scope="col"` headers, caption or `aria-label`, tabular-nums preserved,
  status never conveyed by color alone.

### 5.2 Hooks / constants / types

- `hooks/`: one file per hook + co-located test. Promote `web-admin/lib/hooks/*` to
  `web-admin/hooks/*` and update imports. Hoist inline hooks out of component files.
- `constants/`: one file per feature (`constants/overview.ts`, `constants/nav.ts`, …). Named exports.
  No magic array/label-map left inline.
- `types/`: split `types/components.ts` into `types/<feature>.ts` (e.g. `overview.ts`, `wallet.ts`,
  `chat.ts`, `kyc.ts`, `admin/*.ts`) with a `types/index.ts` barrel. Codemod the 127
  `@/types/components` imports to `@/types`. Prop types stay `XxxProps` (§13.4). Shared/domain
  shapes still come from `@handshake-agent/contracts`.

## 6. `web` route-promotion model

A route group **`app/(app)/`** with one responsive `layout.tsx`:

- **lg+ (desktop):** `DashboardSidebar` + `DashboardTopbar` + `{children}` + persistent `ChatRail`
  (surface `"d"`). Sidebar nav → `/` (overview), `/wallet`, `/activity`, `/tickets`, `/settings`.
- **<lg (mobile):** `{children}` + `MobileTabbar` + confirm/pin/success overlays (surface `"m"`).
  Tabbar nav → `/chat`, `/wallet`, `/activity`, `/settings`.

Routes (each `page.tsx` is the orchestrator that used to be the `*-page.tsx` / tab view):

| Route       | Desktop view          | Mobile view |
| ----------- | --------------------- | ----------- |
| `/` (index) | Overview              | Overview\*  |
| `/chat`     | (rail already on)\*\* | Chat        |
| `/wallet`   | Wallet                | Wallet      |
| `/activity` | Activity              | Activity    |
| `/tickets`  | Tickets               | Tickets\*   |
| `/settings` | Settings              | Settings    |

\* Mobile currently has no overview/tickets tab; those routes still exist and are deep-linkable, but
the mobile tabbar keeps its current four tabs (chat/wallet/activity/settings) so mobile nav behavior
is unchanged. \*\* On desktop the chat rail is always mounted in the layout; `/chat` on desktop
redirects to `/`.

- `DashboardExperience`, `MobileShell`, and `AdaptiveExperience` **dissolve into the layout**. The
  `useState` view-switchers and the `DashboardPage` / `MobileTabId` unions are replaced by the router;
  `usePathname` drives active-nav state. Responsiveness becomes the layout's job (CSS breakpoints:
  `hidden lg:flex` etc.), not a `useIsDesktop` client branch. `useIsDesktop` is retained only if a
  non-layout consumer still needs it; otherwise removed.
- **Default landing preserved:** desktop lands on `/` (overview); mobile's home tab is `/chat`. The
  surface-aware default landing keeps today's intent (post-login → overview on desktop, chat on
  mobile). Implementation detail (client surface hint vs. per-surface default) finalized in the plan.
- **Legacy redirects:** `/dashboard` → `/`, `/app` → `/chat`, preserved so existing links and E2E
  entrypoints resolve. E2E specs are updated to the new canonical routes (the deliberate behavior
  change).
- Chat store singleton (`defaultChatStore`) and its surface keying (`"d"`/`"m"`) are unchanged; the
  session-expired redirect handler is injected from the layout.

## 7. Componentisation pattern (applied to every page/view/component)

For each target:

1. Identify orchestration (data hooks, branches, handlers) vs. presentational sections.
2. Extract each section into `components/<feature>/<section>.tsx` (≤150 lines, one job). Co-locate,
   no separate `sections/` subfolder.
3. Route/page file keeps only: hooks, the four async branches, handlers, and `<Section … />`
   composition.
4. Replace ad-hoc tables with `DataTable` + a `constants/<feature>.ts` column config.
5. Hoist inline hooks → `hooks/`; magic values → `constants/`; inline types → `types/<feature>.ts`.
6. Enforce caps: component ≤150, file ≤300, function ≤40; early returns over deep nesting.

**Worked example — `overview` (`web`):**

- `app/(app)/page.tsx` — orchestrator (balances/assets/activity hooks, capability gate, four branches).
- `components/overview/balance-hero.tsx` — hero + hero-action buttons.
- `components/overview/assets-table.tsx` — `DataTable` over wallet assets.
- `components/overview/recent-activity-table.tsx` — `DataTable` over the activity feed.
- `constants/overview.ts` — `HERO_ACTIONS`, activity/asset column configs.
- `types/overview.ts` — the props types.

## 8. Testing — full TDD per extracted piece

- For every new unit (primitive, section, hook, DataTable wrapper): write its focused test **first**
  (render + props + each branch), then extract, then green. Red → green → refactor.
- The **existing** unit + e2e suites are the behavior guard; they must stay green after every wave.
  E2E is updated **once** for the new `web` routes (§6) and thereafter stays green.
- Coverage: ~100% on new reusable primitives/hooks; sections tested for their branches and prop
  contracts. No net coverage regression.
- Every wave ends with `pnpm lint && pnpm typecheck && pnpm test` green and `pnpm depcruise` clean,
  verified independently (not self-reported by a subagent), before its PR.

## 9. Delivery — phased PRs (web first)

Each item below is one or more mergeable PRs; each is green on its own.

- **Wave 0 — Foundation (both apps).** `Table` (web) + `DataTable` (both); create `hooks/` +
  `constants/`; split `types/` into per-feature + barrel + codemod imports; promote admin `lib/hooks`;
  write CLAUDE.md standards (§11). No page refactors — rails only.
- **Wave 1 — `web` route promotion.** `app/(app)/` group + responsive `layout.tsx` + legacy
  redirects + E2E update. Shells → layout; each view becomes a route orchestrator (decomposition of
  sections may be minimal here — the goal is correct routing with green tests).
- **Wave 2 — `web` view/section componentisation.** Decompose every route orchestrator into sections
  - DataTables + constants/types; then remaining `web` features (chat, kyc, auth, onboarding,
    settings, pwa, seo).
- **Wave 3 — `web-admin` foundation** (its DataTable + hooks/constants/types split), then admin waves:
  (a) app-shell + users + transactions, (b) compliance/aml/sanctions, (c) treasury/recon/ops,
  (d) config pages (settings/pricing/limits/capabilities/flags/currencies/assets/templates/providers),
  (e) remaining (metrics/audit/webhooks/notifications/agent/whatsapp/roles/admins/tickets/beneficiaries/ledger/approvals/blocked/sessions/account).

`web-admin` gets its **own implementation plan** authored after Wave 2 proves the pattern.

## 10. Execution mechanics (ultracode)

- Read-only fan-out via the **Workflow** tool for (a) the per-file **audit** that produces the
  authoritative extraction work-list per wave, and (b) **adversarial review** after each wave.
- The mutating TDD edits are done wave-by-wave (not parallel agents editing shared `constants/`,
  `types/`, and primitive files) to keep tests tight and avoid merge conflicts. Where a wave's files
  are genuinely disjoint, parallelize with worktree isolation.
- Independent gate verification after each subagent task (per repo memory: implementers over-report
  green).

## 11. CLAUDE.md changes

- **Root `CLAUDE.md`** — new **§16 "Componentisation & modularisation"**:
  - Route/`page.tsx` files are orchestrators only: data hooks + four async branches + composition.
    No large inline section markup.
  - No `*-page.tsx` component masquerading as a page — a page lives in `app/`. Reusable views/sections
    live in `components/<feature>/`.
  - Tabular data renders through the `Table` primitive via `shared/DataTable`. No raw `<table>` or
    div-grid tables.
  - All hooks in `hooks/` (no `useXxx` defined in a component file). All magic values in `constants/`.
    All types per-feature under `types/` + barrel (no inline interfaces beyond trivial locals).
  - Reaffirm caps: component ≤150, file ≤300, function ≤40 (§13.3), and "extract at three" (§13.2).
- **`web/CLAUDE.md`** — document the `(app)` route group + responsive layout, the canonical route
  list, legacy redirects, and the surface (`"d"`/`"m"`) chat model.
- **`web-admin/CLAUDE.md`** — document the `AppShell` + route-orchestrator + `DataTable` pattern and
  the `hooks/`/`constants/`/`types/` layout.

## 12. Risks & mitigations

- **Route promotion changes behavior (URLs/history).** Mitigate: legacy redirects; E2E updated in the
  same PR; manual preview verification of desktop + mobile default landing, nav, chat rail persistence,
  and confirm/pin/success overlays before merge.
- **Type-import codemod breakage (127 sites).** Mitigate: mechanical `@/types/components` → `@/types`
  with barrel re-export; `typecheck` gate catches misses; do it in Wave 0 in isolation.
- **Chat store surface coupling.** The `"d"`/`"m"` keying and overlay surface scoping must survive the
  shell→layout move. Mitigate: keep the store untouched; only move where handlers are injected;
  dedicated tests for rail (desktop) and `/chat` (mobile).
- **Over-fragmentation.** Extract at the section boundary, not every element. A section that is genuinely
  one cohesive block stays one file even if slightly under the cap.
- **Scope creep into unrelated drift.** Aggregate unrelated findings into a "Drift found" list (§13);
  fix in-scope only when small and in a file already being edited.

## 13. Definition of done (per wave)

- Targeted files at/under caps; no raw tables; no inline hooks/constants/types.
- New units have tests (TDD); full suite + typecheck + lint + depcruise green (independently verified).
- Behavior/pixels unchanged (except Wave 1's routes); preview-verified where observable.
- Conventional-commit PR, one coherent change; CLAUDE.md updated when standards change (Wave 0).

## 14. Definition of done (program)

Every page and component in `web` and `web-admin` is an orchestrator-plus-small-components structure;
all tabular data uses `DataTable`; `hooks/`, `constants/`, and per-feature `types/` are the sole homes
for those concerns; `web` runs on real routes; CLAUDE.md encodes the standards; all gates green.
