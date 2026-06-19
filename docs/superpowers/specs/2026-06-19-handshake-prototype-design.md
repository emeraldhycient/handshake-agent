# Handshake Agent Prototype — Implementation Design

**Date:** 2026-06-19
**Status:** Approved (brainstorming → spec)
**Source design:** `docs/design/_ref/handshake-prototype.html` (extracted from the Claude Design project "Crypto wallet design system", file `Handshake Agent Prototype.dc.html`).
**Scope target:** the `web/` Next.js 16 app only. No `api/` work in this slice.

---

## 1. Goal

Implement the Handshake Agent prototype as a real, architecture-compliant Next.js 16 frontend, faithful to the prototype's visuals and interaction flow, covering **both surfaces** the prototype defines:

1. **Mobile chat-native app** — KYC onboarding → an app with Chat / Wallet / Activity tabs, chat message cards (quote, balance, receive, tickets, receipt), and the confirm-sheet → PIN-pad → success overlay flow.
2. **Desktop wallet dashboard** — sidebar (Overview / Wallet / Activity / Tickets / Settings), top bar with search + notifications, the five pages, and a persistent chat rail — with the same confirm → PIN → success flow as a centered modal.

The defining interaction is the **quote → itemized confirmation → PIN → receipt** money flow, which mirrors the repo's sacrosanct §3.1 "model proposes, engine disposes" invariant.

### Decisions locked during brainstorming

- **Surface scope:** both surfaces, full fidelity.
- **Data:** full architecture plumbing against an in-memory **mock API** (TanStack Query + Zustand + Axios + contracts), swappable to a real API by a single client flag.
- **Testing:** full TDD — logic _and_ every component (Vitest + RTL), plus 1–2 Playwright happy-path smokes.
- **Structure:** Approach A — one shared headless chat engine in `lib/` drives both surfaces; message cards are single canonical components taking a `density: 'mobile' | 'desktop'` prop; separate routes `/onboarding`, `/app`, `/dashboard`.
- **Landing:** `/` is a simple brand launcher linking to the experiences; the prototype's side-by-side showcase is a demo device, not reproduced as a product route.

---

## 2. Non-goals (YAGNI)

- No real backend, no real wallet/WaaS provider, no real KYC vendor, no real pricing feed. The mock client stands in.
- No real authentication/session. The KYC screen is presentational and routes onward on "Finish".
- No dark mode polish — the design is light/cream only. Dark tokens are kept syntactically valid so shadcn primitives don't break, but the app renders light.
- No `sell` as a distinct flow — the prototype models "cash out" as `swap` (USDT→naira). We mirror the prototype exactly; a true `crypto.sell` capability is future work.
- No server-side KYC/limit/sanctions gate (that is backend, §3.3). The UI reflects verified state and Tier-3 limits only; the spec notes that the real gate is server-side.

---

## 3. Architecture

Strict downward layering per root §4.1 and `web/CLAUDE.md`: `app/ → components/ → lib/ → types/`. `components/` never fetches or imports from `app/`; `lib/` is the only layer that talks to the (mock) outside world. Enforced by `dependency-cruiser`.

```
packages/contracts/src/
  intent.ts        Intent enum + schema (validated structured intent — "model proposes")
  money.ts         Money/Asset/Balance
  quote.ts         Quote, QuoteRow, ConfirmPayload
  receipt.ts       Receipt
  deposit.ts       DepositAddress
  tickets.ts       Event, TicketTier, Ticket
  activity.ts      ActivityItem, ActivityGroup
  notifications.ts Notification, SearchResult
  chat.ts          ChatMessage discriminated union (kind: text|quote|balance|receive|tickets|receipt)
  index.ts         barrel

web/
  app/
    layout.tsx           fonts (Figtree + IBM Plex Mono) + <Providers>
    globals.css          brand oklch tokens + status semantics
    page.tsx             launcher
    onboarding/page.tsx  KYC summary → /app
    app/page.tsx         mobile surface (chat/wallet/activity + overlays)
    dashboard/page.tsx   desktop surface (sidebar + 5 pages + chat rail + overlays)
  components/
    providers.tsx        QueryClientProvider + ThemeProvider (client)
    ui/                  shadcn primitives (button[exists], input, dialog, sheet,
                         scroll-area, skeleton, badge, avatar, switch, separator)
    shared/              money, detail-rows, status-pill, asset-icon, qr-placeholder
    chat/
      chat-thread.tsx    typing + message list (ref auto-scroll)
      chat-composer.tsx  suggestion chips + input + send
      chat-message.tsx   dispatch on msg.kind
      typing-indicator.tsx
      cards/             quote-card, balance-card, receive-card, tickets-card, receipt-card
                         (each: density 'mobile' | 'desktop')
      overlays/          confirm-sheet (Sheet@mobile / Dialog@desktop), pin-pad, success-overlay
    onboarding/          kyc-summary
    mobile/              mobile-shell, chat-header, mobile-tabbar, wallet-tab, activity-tab
    desktop/             dashboard-sidebar, dashboard-topbar (search + notifications),
                         chat-rail, overview-page, wallet-page, activity-page,
                         tickets-page, settings-page
  lib/
    utils.ts             cn() (exists)
    constants.ts         asset tints, network labels, copy strings
    chat/
      intent.ts          parseIntent(text): Intent           (pure, TDD)
      flow.ts            response/quote/confirm builders      (pure, TDD)
    store/
      chat-store.ts      Zustand: thread, composer, overlays, PIN machine (TDD)
    api/
      client.ts          single Axios instance + interceptors
      mock/index.ts      in-memory backend (reads/mutations), schema-validated
      gateway.ts         resolves mock vs real client by flag
      fixtures.ts        balances, activity, events, notifications, search catalog
    query/
      keys.ts            query-key factory
      hooks.ts           useBalances, useActivity, useDepositAddress, useEvents,
                         useNotifications, useSearch, useCreateQuote, useExecuteTransaction
  types/                 component XxxProps + re-exports of contracts inferred types
  vitest.config.ts · vitest.setup.ts
  e2e/                   Playwright happy-path smokes
```

### Surface keying

The chat store keys threads by surface (`'m'` mobile, `'d'` desktop) exactly as the prototype does, so `/app` and `/dashboard` hold independent conversations and overlay state.

---

## 4. Data flow — the money path (the important part)

This realizes §3.1 in the UI layer. No free-text ever becomes a financial parameter; amounts are always read from the structured quote object.

```
user types / taps chip
   │
   ▼
parseIntent(text) ──► Intent  (validated enum: buy|send|receive|swap|ticket|balance|null)
   │                          ("model proposes": a structured intent, never a transaction)
   ▼
flow builder + useCreateQuote(intent, params)  ──► Quote (mock client, schema-parsed)
   │                                                rows are itemized fees, locked rate
   ▼
assistant appends Quote card to thread   ("Review & confirm")
   │ user taps Review & confirm
   ▼
openConfirm(ConfirmPayload)  ──► confirm sheet/modal: exact itemized parameters,
   │                              warn banner for first-time addresses, total
   │ user taps "Confirm with PIN"
   ▼
pin-pad (4 digits or Face ID)
   │ pinComplete()  ── the ONLY path that executes ──►
   ▼
useExecuteTransaction(quoteId)  ──► Receipt (mock client, idempotency key)
   │
   ▼
assistant appends Receipt card + success overlay; balances invalidated
```

`pinComplete()` is the single execution gate: nothing appends a receipt or mutates mock balances before a 4-digit PIN (or Face ID) is entered. Cancelling at any step clears `pending` and resets overlay state without side effects.

---

## 5. Tokens & fonts

- **Fonts** (`layout.tsx`): `Figtree` (subsets latin, weights 400–800) → `--font-sans`; `IBM_Plex_Mono` (weights 400/500) → `--font-mono`. `--font-heading` aliases sans.
- **`globals.css`** `:root` rewritten to brand oklch values (converted from the prototype hex), keeping shadcn's token names so primitives keep working, and adding fixed status tokens exposed through `@theme inline` so `bg-success`, `text-warn`, `bg-info-muted`, etc. are real utilities:

| Token                           | Source hex            | Role                                                           |
| ------------------------------- | --------------------- | -------------------------------------------------------------- |
| `--background`                  | `#f3efe7`             | app surface (cream)                                            |
| `--foreground`                  | `#16261e`             | near-black green text                                          |
| `--card` / `--popover`          | `#ffffff` / `#fbfaf6` | card surfaces                                                  |
| `--primary`                     | `#1a4536`             | brand deep green (headers, user bubble)                        |
| `--primary-deep`                | `#0e241c`             | gradient end                                                   |
| `--primary-foreground`          | `#f1f3ee`             | on-green text                                                  |
| `--accent`                      | `#f5a623`             | amber CTA                                                      |
| `--accent-deep`                 | `#e8961a`             | amber gradient/hover                                           |
| `--accent-foreground`           | `#1c1205`             | on-amber text                                                  |
| `--muted-foreground`            | `#6a776e`             | secondary text (`#8a9389`/`#9aa399` as `--muted-foreground-2`) |
| `--border`                      | `#ebe5d8`             | hairlines                                                      |
| `--success` / `--success-muted` | `#1f8a5b` / `#e6f3ec` | success pill                                                   |
| `--warn` / `--warn-muted`       | `#9a6a12` / `#fbeece` | warning banner/pill                                            |
| `--info` / `--info-muted`       | `#3b5bb5` / `#eef0fb` | info pill                                                      |
| `--danger`                      | (= `--destructive`)   | destructive                                                    |

- Asset tints (USDT `#7fd1a8`, BTC `#f5c46b`, NGN `#cfe6d8`) and category icon tints are **data**, defined in `lib/constants.ts` / fixtures and passed via props — components stay hex-free (§5/§13.5).
- Numeric displays use Tailwind's `tabular-nums` utility (prototype `.tnum`); addresses/refs use `font-mono` (prototype `.mono`).

---

## 6. Contracts (shared Zod schemas, §8)

Defined once in `packages/contracts`, `z.infer` types, imported by the mock client (parse outputs), query hooks, and component prop types. Key shapes:

- `IntentSchema` — `z.enum(['buy','send','receive','swap','ticket','balance'])` plus `null` for "unrecognized". This is the agent's structured-output contract (§3.1/§6).
- `QuoteRowSchema` `{ label, value }`; `QuoteSchema` `{ id, kind, receiveAmt, receiveSub, rows[], totalLabel, totalValue, lockSeconds }`; `ConfirmPayloadSchema` `{ title, subtitle, heroLabel, heroAmount, heroSub, toLabel?, toValue?, warn?, rows[], totalLabel, totalValue, cta }`.
- `ReceiptSchema` `{ title, subtitle, amount, rows[], ref }`.
- `AssetSchema` / `BalanceSchema` `{ total, assets[] }`.
- `DepositAddressSchema` `{ asset, network, address, minDeposit, creditedEta }`.
- `EventSchema`, `TicketTierSchema`, `TicketSchema`.
- `ActivityItemSchema`, `ActivityGroupSchema`.
- `NotificationSchema`, `SearchResultSchema`.
- `ChatMessageSchema` — discriminated union on `kind` (`text|quote|balance|receive|tickets|receipt`) with `role` and an `id`.

Validity/invalidity fixtures tested by parsing (§9).

---

## 7. Components

- **`ui/`** — shadcn primitives only, added via `pnpm dlx shadcn@latest add …`. Canonical, never forked (§13.1). PIN pad is hand-composed (no primitive fits), built on `Button`.
- **`shared/`** — `Money` (tabular-nums formatter), `DetailRows` (the label/value list reused by quote + confirm + receipt — §13.2 "three is a pattern"), `StatusPill` (success/warn/info/neutral semantics), `AssetIcon` (tinted symbol chip), `QrPlaceholder` (the CSS QR motif).
- **`chat/`** — `ChatThread` (auto-scroll via ref; renders typing indicator + messages), `ChatComposer` (horizontal-scroll suggestion chips + `+`/input/mic/send), `ChatMessage` (dispatches on `kind`), and `cards/*` each accepting `density`. `overlays/ConfirmSheet` renders a bottom `Sheet` at mobile density and a centered `Dialog` at desktop density from one component; `PinPad`; `SuccessOverlay`.
- **`onboarding/KycSummary`** — step 3 of 3: phone verified, BVN/NIN matched, liveness done, encryption note, "Finish & open my wallet".
- **`mobile/`** — `MobileShell` (gradient chat header + thread + composer + bottom tabbar; or wallet/activity tab bodies), `ChatHeader`, `MobileTabbar`, `WalletTab`, `ActivityTab`.
- **`desktop/`** — `DashboardSidebar`, `DashboardTopbar` (greeting + search dropdown + notifications dropdown), `ChatRail`, and pages `OverviewPage`, `WalletPage`, `ActivityPage`, `TicketsPage`, `SettingsPage`.

Every async-backed surface implements all four branches — loading (skeleton), error (inline error card with retry), empty, data (§5/§13.6).

---

## 8. Routes

- `/` — launcher: brand intro + entry cards to `/app` and `/dashboard`, plus "Start onboarding".
- `/onboarding` — `KycSummary`; "Finish" navigates to `/app`.
- `/app` — mobile surface; full-bleed on phones, centered phone-width column on large screens.
- `/dashboard` — desktop surface; sidebar + active page + persistent chat rail + overlays.

---

## 9. Testing (full TDD, §9)

Setup: `vitest.config.ts` (jsdom, `@vitejs/plugin-react`, globals, setup file), `vitest.setup.ts` (`@testing-library/jest-dom`, cleanup), `"test"`/`"test:watch"` scripts in `web/package.json` so the `turbo test` gate covers web. `pnpm exec playwright install` once.

**Red → green → refactor on logic (~100%):**

- contracts: parse valid + rejected-invalid fixtures for every schema.
- `parseIntent`: table-driven (each keyword group → expected intent; unknown → null).
- `flow.ts`: each builder returns the expected message/quote/confirm shape.
- `chat-store.ts`: send→typing→card; chip→quote; openConfirm→confirmToPin→press 4 digits→receipt + success; Face ID path; cancel clears pending with no receipt; reset; per-surface isolation.
- mock client: each method returns schema-valid data; `executeTransaction` is idempotent on a repeated key.
- query hooks: resolve via `QueryClient` test wrapper over the mock; mutation invalidates balances.

**Component tests (RTL + user-event) — every card/page/overlay/nav, both densities:**

- each card renders its fields and formats amounts with tabular-nums; `density` variants render.
- composer chip tap and Enter submit dispatch; thread auto-scrolls.
- confirm sheet shows itemized rows, total, and the first-time-address warn; PIN pad accepts exactly 4 digits and only then triggers execution; cancel closes without a receipt.
- mobile tab nav and desktop sidebar/page nav switch content; desktop search filters the catalog; notifications mark-all-read; settings toggles (bio switch, language).
- a11y: icon buttons have `aria-label`; overlays trap focus and close on `Esc`; color is never the only status signal (pill has text).

**E2E (Playwright):** buy-flow happy path on `/app` and on `/dashboard` (chip → quote → confirm → PIN → receipt + success).

---

## 10. Invariants checklist (honored by this design)

- **§3.1 model proposes / engine disposes** — `parseIntent` yields a validated `Intent`; `flow` yields a proposed `Quote`; execution (`useExecuteTransaction` → receipt) happens only after the itemized confirm and a 4-digit PIN. Amounts come from the quote, never the message text.
- **§3.2 / §4 layering** — components never fetch; only `lib/` touches the mock client; `dependency-cruiser` stays green.
- **§3.3** — server-side KYC/limit gate is out of scope (backend); UI shows verified/Tier-3 state only and the spec records that the real gate is server-side.
- **§5 / §13** — tokens only (no component hex), four async branches, one canonical primitive per concept, shared atoms for repeated shapes, centralized `XxxProps` types.
- **§8** — every cross-boundary shape lives in `packages/contracts`.
- **§9** — strict TDD; coverage gate holds.

---

## 11. Risks / watch-items

- **Tailwind v4 token wiring** — new status utilities must be registered in `@theme inline`; verify `bg-success` etc. compile before building cards on them.
- **shadcn `Sheet`/`Dialog` under Next 16 / React 19** — confirm the generated primitives type-check; the unified `radix-ui` import style is required (no individual `@radix-ui/*`).
- **`zod` single-instance** — keep contracts' `zod` as a peer and pinned `^3.25.x` so FE and contracts resolve one copy (§6/§8); two copies cause silent `ZodType` identity bugs.
- **next/font + Turbopack** — Figtree/IBM Plex Mono must load via `next/font/google`; verify variable wiring in `layout.tsx`.
- **Scope size** — two surfaces × full TDD is large; implementation plan will sequence it as foundation → contracts → engine → mock/query → shared atoms → cards → overlays → mobile shell → desktop shell → routes → E2E, each TDD'd.
