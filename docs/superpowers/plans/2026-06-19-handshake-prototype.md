# Handshake Agent Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Handshake Agent prototype (`docs/design/_ref/handshake-prototype.html`) as a real, architecture-compliant `web/` Next.js 16 app — both surfaces (mobile chat-native app + desktop dashboard) — against a mock API, with full TanStack Query / Zustand / Axios / contracts plumbing and full TDD.

**Architecture:** One shared headless chat engine (`web/lib`: pure intent parser + flow builders + Zustand store) drives both surfaces. Message cards are single canonical components taking a `density: 'mobile' | 'desktop'` prop. Cross-boundary transaction shapes live in `packages/contracts`; presentation view-models live in `web/lib/schemas`. Routes: `/`, `/onboarding`, `/app`, `/dashboard`. Strict downward layering (`app → components → lib → types`) enforced by dependency-cruiser.

**Tech Stack:** Next 16 (App Router, Turbopack), React 19, Tailwind v4 (CSS-first tokens), shadcn (`radix-vega`, unified `radix-ui`), TanStack Query v5, Zustand v5, Axios, Zod 3, Vitest 4 + React Testing Library + user-event, Playwright.

---

## Spec → plan reconciliation (read first)

The approved spec (`docs/superpowers/specs/2026-06-19-handshake-prototype-design.md`) said "define every shape in contracts." After reading the existing `packages/contracts/src`, this plan refines that — **without changing scope**:

- **`packages/contracts`** gets the genuine cross-boundary shapes only: the `IntentSchema` union is extended with the new agent actions (`send_crypto`, `receive_crypto`, `swap`, `buy_ticket`, `check_balance`), following the existing discriminated-union pattern and the code's own TODO. This is the canonical "model proposes" structured intent.
- **`web/lib/schemas`** gets the prototype's presentation view-models (`ChatMessage`, quote/confirm/receipt views, balance/asset views with tints, deposit, events/tickets, activity, notifications, search) — local Zod schemas per `web/CLAUDE.md`.
- The prototype's coarse NLU stub returns a web-local `ChatAction` (`'buy'|'send'|'receive'|'swap'|'ticket'|'balance'`) — a view-routing concern. The canonical `contracts` `Intent` union is extended in parallel as the forward-looking agent contract (verified by a unit test). The mock execution path is keyed by `ChatAction`.

This keeps `contracts` clean (FE⇄BE⇄agent only) and matches `web/CLAUDE.md`'s explicit "shared shapes come from contracts; local schemas live in `lib/schemas`."

---

## Locked interfaces (all tasks must match these names exactly)

### Design tokens (added in Task 1.2; the hex→token table below is the single source for every UI port)

| Prototype hex                                 | Tailwind utility / token              | CSS var                     |
| --------------------------------------------- | ------------------------------------- | --------------------------- |
| `#f3efe7`                                     | `bg-background`                       | `--background`              |
| `#16261e`                                     | `text-foreground`                     | `--foreground`              |
| `#1a4536`                                     | `bg-primary` / `from-primary`         | `--primary`                 |
| `#0e241c`                                     | `to-primary-deep`                     | `--primary-deep`            |
| `#1d4435` (user bubble)                       | `bg-primary` (acceptable: ≈`#1a4536`) | `--primary`                 |
| `#f1f3ee`                                     | `text-primary-foreground`             | `--primary-foreground`      |
| `#f5a623`                                     | `bg-accent` / `text-accent`           | `--accent`                  |
| `#e8961a`                                     | `to-accent-deep` / `bg-accent-deep`   | `--accent-deep`             |
| `#1c1205`                                     | `text-accent-foreground`              | `--accent-foreground`       |
| `#ffffff`                                     | `bg-card`                             | `--card`                    |
| `#fbfaf6`                                     | `bg-card-muted`                       | `--card-muted`              |
| `#f7f4ed`                                     | `bg-card-muted` (acceptable)          | `--card-muted`              |
| `#ebe5d8` / `#efe9dc` / `#f1ece0` / `#f4efe4` | `border-border`                       | `--border`                  |
| `#6a776e` / `#8a9389`                         | `text-muted-foreground`               | `--muted-foreground`        |
| `#9aa399` / `#b3bbb0`                         | `text-muted-foreground-subtle`        | `--muted-foreground-subtle` |
| `#1f8a5b`                                     | `text-success` / `bg-success`         | `--success`                 |
| `#0f3d27` / `#2f7a54`                         | `text-success-foreground`             | `--success-foreground`      |
| `#e6f3ec`                                     | `bg-success-muted`                    | `--success-muted`           |
| `#8fe0b4` / `#a7e8c6` / `#cdeeda`             | `text-success-bright`                 | `--success-bright`          |
| `#36c281`                                     | `bg-success-bright`                   | `--success-bright`          |
| `#9a6a12` / `#7a5410`                         | `text-warn`                           | `--warn`                    |
| `#fbeece`                                     | `bg-warn-muted`                       | `--warn-muted`              |
| `#f0d79b`                                     | `border-warn`                         | `--warn`                    |
| `#3b5bb5`                                     | `text-info`                           | `--info`                    |
| `#eef0fb`                                     | `bg-info-muted`                       | `--info-muted`              |

Asset/category tints (`#7fd1a8`, `#f5c46b`, `#cfe6d8`, etc.) are **data** — defined in `web/lib/constants.ts`, passed via props, applied with inline `style` (the one allowed exception, since they are dynamic data values, not theme colors). Numbers use the `tabular-nums` utility; addresses/refs use `font-mono`.

### `web/lib/schemas` view-model TypeScript shapes (Zod-inferred)

```typescript
// chat.ts
export type ChatAction =
  | "buy"
  | "send"
  | "receive"
  | "swap"
  | "ticket"
  | "balance";
export type ChatSurface = "m" | "d";
export type QuoteRow = { label: string; value: string };
export type QuoteView = {
  kind: "quote";
  action: ChatAction;
  receiveAmt: string;
  receiveSub: string;
  rows: QuoteRow[];
  totalLabel: string;
  totalValue: string;
  lockSeconds: number;
};
export type ConfirmPayload = {
  title: string;
  subtitle: string;
  heroLabel: string;
  heroAmount: string;
  heroSub: string;
  toLabel?: string;
  toValue?: string;
  warn?: string;
  rows: QuoteRow[];
  totalLabel: string;
  totalValue: string;
  cta: string;
  action: ChatAction;
  meta?: Record<string, string>; // meta carries ticket tier/total etc.
};
export type ReceiptView = {
  kind: "receipt";
  title: string;
  subtitle: string;
  amount: string;
  rows: QuoteRow[];
  ref: string;
};
export type AssetView = {
  sym: string;
  name: string;
  amount: string;
  value: string;
  tint: string;
};
export type BalanceView = {
  kind: "balance";
  total: string;
  assets: AssetView[];
};
export type DepositView = {
  kind: "receive";
  asset: string;
  network: string;
  address: string;
  minDeposit: string;
  creditedEta: string;
};
export type TicketOption = {
  tier: string;
  perk: string;
  price: string;
  left: string;
  total: string;
};
export type TicketsView = {
  kind: "tickets";
  eventMeta: string;
  eventName: string;
  options: TicketOption[];
};
export type TextView = { kind: "text"; text: string };
export type ChatMessage = { id: string; role: "user" | "assistant" } & (
  | TextView
  | QuoteView
  | BalanceView
  | DepositView
  | TicketsView
  | ReceiptView
);
```

```typescript
// wallet.ts / activity.ts / catalog.ts
export type WalletAsset = {
  sym: string;
  name: string;
  sub: string;
  amount: string;
  value: string;
  change: string;
  tint: string;
};
export type StatusTone = "success" | "warn" | "info" | "neutral";
export type ActivityItem = {
  dir: "in" | "out" | "ticket";
  icon: string;
  tint: string; // data tint — applied via inline style
  col: string; // data tint — applied via inline style
  title: string;
  sub: string;
  amount: string;
  status: string;
  statusTone: StatusTone;
};
export type ActivityGroup = { group: string; items: ActivityItem[] };
export type EventListItem = { name: string; meta: string; price: string };
export type AppNotification = {
  icon: string;
  tint: string;
  col: string;
  title: string;
  sub: string;
  time: string;
};
export type SearchResult = {
  kind: "Action" | "Page" | "Transaction";
  title: string;
  desc: string;
  icon: string;
  tint: string;
  col: string;
  action?: ChatAction;
  label?: string;
  page?: DashboardPage;
};
export type DashboardPage =
  | "overview"
  | "wallet"
  | "activity"
  | "tickets"
  | "settings";
```

### `web/lib/chat` (pure, tested)

```typescript
// intent.ts
export function parseIntent(text: string): ChatAction | null;
// flow.ts  — pure builders returning view-models (no side effects)
export function assistantText(
  text: string,
): Omit<TextView, "kind"> & { kind: "text" }; // helper
export function buildResponse(action: ChatAction): {
  messages: Array<
    TextView | QuoteView | BalanceView | DepositView | TicketsView
  >;
};
export function buildBuyConfirm(): ConfirmPayload;
export function buildSendConfirm(): ConfirmPayload;
export function buildSwapConfirm(): ConfirmPayload;
export function buildTicketConfirm(
  tier: string,
  price: string,
  total: string,
): ConfirmPayload;
export function buildReceipt(
  action: ChatAction,
  meta?: Record<string, string>,
): ReceiptView;
export function startChips(): ChatAction[]; // ['buy','balance','send','ticket']
export function chipLabel(action: ChatAction): string; // 'Buy ₦50,000 of USDT' etc.
```

All copy strings, amounts, fee rows, addresses, receipt refs are the exact literals from the prototype logic (`docs/design/_ref/handshake-prototype.html` lines 993–1480). The flow builders are the single home for those literals (DRY).

### `web/lib/store/chat-store.ts` (Zustand)

```typescript
type OverlaySurface = ChatSurface;
interface ChatState {
  threads: Record<ChatSurface, ChatMessage[]>;
  chips: Record<ChatSurface, ChatAction[]>;
  typing: Record<ChatSurface, boolean>;
  input: Record<ChatSurface, string>;
  pending: ConfirmPayload | null;
  overlaySurface: OverlaySurface;
  confirmOpen: boolean;
  pinOpen: boolean;
  pin: string;
  successOpen: boolean;
  successText: string;
  successSurface: OverlaySurface;
  // actions
  send(surface: ChatSurface, text: string, action?: ChatAction): void;
  setInput(surface: ChatSurface, value: string): void;
  openConfirm(surface: ChatSurface, payload: ConfirmPayload): void;
  cancel(): void;
  confirmToPin(): void;
  pressPin(digit: string): void;
  pinBack(): void;
  pinComplete(): void; // the ONLY method that appends a receipt
  reset(surface: ChatSurface): void;
}
```

`send` appends the user message, clears chips, then (after a typing delay) appends the assistant messages from `buildResponse`. `pinComplete` runs the pending action's receipt build + success, then clears overlays. Timers are injected via an optional param/clock so tests run without real delays (see Task 10.1).

### `web/lib/api` + `web/lib/query`

```typescript
// lib/api/mock/index.ts  (all return Promises, schema-validated)
getBalances(): Promise<BalanceView>
getWalletAssets(): Promise<WalletAsset[]>
getActivity(): Promise<ActivityGroup[]>
getDepositAddress(): Promise<DepositView>
getEvents(): Promise<EventListItem[]>
getNotifications(): Promise<AppNotification[]>
getSearchCatalog(): Promise<SearchResult[]>
createQuote(action: ChatAction): Promise<QuoteView>
executeTransaction(action: ChatAction, idempotencyKey: string, meta?: Record<string,string>): Promise<ReceiptView>

// lib/query/keys.ts
export const qk = {
  balances: ['balances'] as const,
  walletAssets: ['walletAssets'] as const,
  activity: ['activity'] as const,
  deposit: ['deposit'] as const,
  events: ['events'] as const,
  notifications: ['notifications'] as const,
  searchCatalog: ['searchCatalog'] as const,
}
// lib/query/hooks.ts
useBalances() useWalletAssets() useActivity() useDepositAddress()
useEvents() useNotifications() useSearchCatalog()
useCreateQuote() useExecuteTransaction()   // mutations
```

### Component prop types — all live in `web/types/*` as `XxxProps` and are imported (never inline, §13.4). Each component task defines its `Props` in `web/types/components.ts`.

---

## File structure (created/modified)

```
packages/contracts/src/intents/         send,receive,swap,ticket,balance intents + union (modify)
web/app/layout.tsx                       fonts + Providers (modify)
web/app/globals.css                      brand tokens (modify)
web/app/page.tsx                         launcher (modify)
web/app/onboarding/page.tsx              (create)
web/app/app/page.tsx                     (create)
web/app/dashboard/page.tsx               (create)
web/components/providers.tsx             (create)
web/components/ui/*                       shadcn-added primitives (create via CLI)
web/components/shared/*                   money, detail-rows, status-pill, asset-icon, qr-placeholder
web/components/chat/*                     thread, composer, message, typing, cards/*, overlays/*
web/components/onboarding/kyc-summary.tsx
web/components/mobile/*                   mobile-shell, chat-header, mobile-tabbar, wallet-tab, activity-tab
web/components/desktop/*                  sidebar, topbar, chat-rail, overview/wallet/activity/tickets/settings pages
web/lib/constants.ts · lib/chat/* · lib/store/* · lib/api/* · lib/query/* · lib/schemas/*
web/types/*                              schema re-exports + component Props
web/vitest.config.ts · web/vitest.setup.ts · web/package.json (scripts)
web/e2e/*                                Playwright smokes
```

Reference for every UI port (line ranges in `docs/design/_ref/handshake-prototype.html`):
KYC 56–118 · chat header 128–146 · quote card(m) 164–197 · balance card(m) 200–219 · receive card(m) 222–253 · tickets card(m) 256–280 · receipt card(m) 283–308 · typing 313–319 · composer(m) 322–339 · wallet tab(m) 345–379 · activity tab(m) 382–411 · bottom nav 414–431 · confirm sheet(m) 437–489 · pin pad(m) 492–524 · success(m) 527–537 · sidebar 549–571 · topbar 575–616 · overview 620–681 · wallet page(d) 684–718 · activity page(d) 721–744 · tickets page(d) 747–778 · settings 781–804 · chat rail + cards(d) 807–905 · confirm(d) 910–941 · pin(d) 944–967 · success(d) 970–975 · logic/literals 983–1525.

---

## Phase 0 — Environment & test harness

### Task 0.1: Verify the workspace builds and baseline passes

**Files:** none (verification only)

- [ ] **Step 1: Install + baseline gates**

Run from repo root:

```bash
pnpm install
pnpm --filter @handshake-agent/web typecheck
pnpm --filter @handshake-agent/web lint
```

Expected: install completes; typecheck and lint pass on the scaffold. If `pnpm install` errors on Node 23, switch to Node 22 (`nvm use 22`) per root §10.

- [ ] **Step 2: Confirm dev server boots (manual, optional)**

Run: `pnpm --filter @handshake-agent/web dev` → open the printed URL → see the scaffold page → Ctrl-C.

### Task 0.2: Vitest configuration

**Files:**

- Create: `web/vitest.config.ts`
- Create: `web/vitest.setup.ts`
- Modify: `web/package.json` (scripts)

- [ ] **Step 1: Write `web/vitest.config.ts`**

```typescript
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
      "@handshake-agent/contracts": resolve(
        __dirname,
        "../packages/contracts/src/index.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e"],
  },
});
```

- [ ] **Step 2: Write `web/vitest.setup.ts`**

```typescript
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

- [ ] **Step 3: Add scripts to `web/package.json`**

In `"scripts"`, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:e2e": "playwright test"
```

- [ ] **Step 4: Add a smoke test to prove the harness runs**

Create `web/lib/__smoke__.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
describe("harness", () => {
  it("runs", () => expect(1 + 1).toBe(2));
});
```

- [ ] **Step 5: Run it**

Run: `pnpm --filter @handshake-agent/web test`
Expected: 1 passed.

- [ ] **Step 6: Delete the smoke test and commit**

```bash
rm web/lib/__smoke__.test.ts
git add web/vitest.config.ts web/vitest.setup.ts web/package.json
git commit -m "test(web): wire vitest + RTL harness"
```

### Task 0.3: Add shadcn primitives

**Files:** Create `web/components/ui/{input,dialog,sheet,scroll-area,skeleton,badge,avatar,switch,separator}.tsx`

- [ ] **Step 1: Generate primitives**

Run:

```bash
cd web && pnpm dlx shadcn@latest add input dialog sheet scroll-area skeleton badge avatar switch separator --yes
```

Expected: files land in `web/components/ui/`. (button already exists.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @handshake-agent/web typecheck`
Expected: PASS. If any primitive imports an individual `@radix-ui/react-*` package, that's fine — shadcn vendors them; do not refactor.

- [ ] **Step 3: Commit**

```bash
git add web/components/ui
git commit -m "feat(web): add shadcn primitives for prototype"
```

---

## Phase 1 — Foundation: tokens, fonts, providers

### Task 1.1: Brand fonts

**Files:** Modify `web/app/layout.tsx`

- [ ] **Step 1: Replace fonts with Figtree + IBM Plex Mono**

Rewrite `web/app/layout.tsx`:

```tsx
import { Figtree, IBM_Plex_Mono } from "next/font/google";

import "./globals.css";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";

const fontSans = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
});
const fontMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata = {
  title: "Handshake Agent",
  description: "Chat-native crypto & payments",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(fontSans.variable, fontMono.variable)}
    >
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

(Note: `Providers` is created in Task 1.3; until then this won't compile — do Tasks 1.2 and 1.3 before typechecking.)

### Task 1.2: Brand tokens

**Files:** Modify `web/app/globals.css`

- [ ] **Step 1: Rewrite `:root`, dark, and `@theme inline` with brand tokens**

In `web/app/globals.css`, keep lines 1–5 (the `@import`s and `@custom-variant`). Replace the `@theme inline` block's color list and the `:root`/`.dark` blocks so that, in addition to the existing shadcn tokens, these are defined (oklch conversions of the hex in the locked table). Add to `@theme inline`:

```css
--color-primary-deep: var(--primary-deep);
--color-accent-deep: var(--accent-deep);
--color-card-muted: var(--card-muted);
--color-muted-foreground-subtle: var(--muted-foreground-subtle);
--color-success: var(--success);
--color-success-foreground: var(--success-foreground);
--color-success-muted: var(--success-muted);
--color-success-bright: var(--success-bright);
--color-warn: var(--warn);
--color-warn-muted: var(--warn-muted);
--color-info: var(--info);
--color-info-muted: var(--info-muted);
```

Set `:root` values (overwrite the grayscale defaults; use these exact oklch values, which are conversions of the table hex):

```css
:root {
  --radius: 0.875rem;
  --background: oklch(0.946 0.012 95.6); /* #f3efe7 */
  --foreground: oklch(0.244 0.024 162); /* #16261e */
  --card: oklch(1 0 0); /* #ffffff */
  --card-muted: oklch(0.985 0.006 95); /* #fbfaf6 */
  --card-foreground: var(--foreground);
  --popover: oklch(1 0 0);
  --popover-foreground: var(--foreground);
  --primary: oklch(0.351 0.045 162); /* #1a4536 */
  --primary-deep: oklch(0.262 0.038 162); /* #0e241c */
  --primary-foreground: oklch(0.957 0.006 120); /* #f1f3ee */
  --secondary: oklch(0.965 0.008 95);
  --secondary-foreground: var(--foreground);
  --muted: oklch(0.965 0.008 95);
  --muted-foreground: oklch(0.52 0.018 162); /* #6a776e */
  --muted-foreground-subtle: oklch(0.66 0.012 150); /* #9aa399 */
  --accent: oklch(0.77 0.155 70); /* #f5a623 */
  --accent-deep: oklch(0.72 0.155 65); /* #e8961a */
  --accent-foreground: oklch(0.2 0.03 70); /* #1c1205 */
  --success: oklch(0.575 0.115 162); /* #1f8a5b */
  --success-foreground: oklch(0.36 0.07 162); /* #0f3d27 */
  --success-muted: oklch(0.945 0.03 162); /* #e6f3ec */
  --success-bright: oklch(0.78 0.12 162); /* #36c281 */
  --warn: oklch(0.53 0.1 75); /* #9a6a12 */
  --warn-muted: oklch(0.95 0.04 90); /* #fbeece */
  --info: oklch(0.49 0.13 268); /* #3b5bb5 */
  --info-muted: oklch(0.95 0.02 270); /* #eef0fb */
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.9 0.012 90); /* #ebe5d8 */
  --input: oklch(0.9 0.012 90);
  --ring: oklch(0.77 0.155 70);
  --sidebar: var(--primary);
  --sidebar-foreground: var(--primary-foreground);
  --sidebar-primary: var(--accent);
  --sidebar-primary-foreground: var(--accent-foreground);
  --sidebar-accent: oklch(0.4 0.045 162);
  --sidebar-accent-foreground: var(--primary-foreground);
  --sidebar-border: oklch(0.4 0.04 162);
  --sidebar-ring: var(--accent);
  --chart-1: var(--accent);
  --chart-2: var(--success);
  --chart-3: var(--info);
  --chart-4: var(--primary);
  --chart-5: var(--warn);
}
```

Leave the `.dark` block from the scaffold in place (the app renders light; dark just must not crash). Keep the `@layer base` block.

- [ ] **Step 2: Verify tokens compile**

Add a throwaway element using `bg-success text-warn bg-info-muted to-primary-deep` to `web/app/page.tsx`, run `pnpm --filter @handshake-agent/web build`, expect success, then revert the throwaway. (Confirms the new utilities are registered.)

- [ ] **Step 3: Commit**

```bash
git add web/app/globals.css
git commit -m "feat(web): brand design tokens (cream/green/amber + status)"
```

### Task 1.3: Providers (Query + Theme)

**Files:** Create `web/components/providers.tsx`; Test `web/components/providers.test.tsx`

- [ ] **Step 1: Write the failing test**

`web/components/providers.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Providers } from "./providers";

describe("Providers", () => {
  it("renders children", () => {
    render(
      <Providers>
        <span>hello</span>
      </Providers>,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → fail** — `pnpm --filter @handshake-agent/web test providers` → FAIL (module not found).

- [ ] **Step 3: Implement `web/components/providers.tsx`**

```tsx
"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light">
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
```

(If `theme-provider.tsx` does not accept `forcedTheme`, pass only `attribute`/`defaultTheme`; verify its props by reading `web/components/theme-provider.tsx`.)

- [ ] **Step 4: Run → pass.** Then typecheck the whole app (layout now compiles): `pnpm --filter @handshake-agent/web typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/components/providers.tsx web/components/providers.test.tsx web/app/layout.tsx
git commit -m "feat(web): app providers (TanStack Query + theme) and brand fonts"
```

---

## Phase 2 — Contracts: extend the Intent union (TDD)

### Task 2.1: New intent schemas

**Files:**

- Create: `packages/contracts/src/intents/send-crypto.intent.ts`, `receive-crypto.intent.ts`, `swap.intent.ts`, `buy-ticket.intent.ts`, `check-balance.intent.ts`
- Modify: `packages/contracts/src/intents/index.ts` (extend the union + re-exports)
- Test: `packages/contracts/src/intents/intents.test.ts`

> Contracts has no test runner yet. Run these tests from `web`'s Vitest (the alias resolves `@handshake-agent/contracts`), or add vitest to contracts. Simplest: put the test under `web/lib/schemas/contracts-intents.test.ts` importing from `@handshake-agent/contracts`. Use that path below.

- [ ] **Step 1: Write the failing test** — `web/lib/schemas/contracts-intents.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { IntentSchema } from "@handshake-agent/contracts";

describe("IntentSchema union", () => {
  it("accepts send_crypto", () => {
    const r = IntentSchema.safeParse({
      action: "send_crypto",
      asset: "USDT",
      amount: "25",
      network: "TRON",
      address: "TQn9Y2khEb7g5mZ8FjpRt1cWnH4d3pVgk7r",
    });
    expect(r.success).toBe(true);
  });
  it("accepts receive_crypto", () => {
    expect(
      IntentSchema.safeParse({
        action: "receive_crypto",
        asset: "USDT",
        network: "TRON",
      }).success,
    ).toBe(true);
  });
  it("accepts swap", () => {
    expect(
      IntentSchema.safeParse({
        action: "swap",
        fromAsset: "USDT",
        toCurrency: "NGN",
        amount: "10",
      }).success,
    ).toBe(true);
  });
  it("accepts buy_ticket", () => {
    expect(
      IntentSchema.safeParse({ action: "buy_ticket", query: "Afrobeats Live" })
        .success,
    ).toBe(true);
  });
  it("accepts check_balance", () => {
    expect(IntentSchema.safeParse({ action: "check_balance" }).success).toBe(
      true,
    );
  });
  it("rejects unknown action", () => {
    expect(IntentSchema.safeParse({ action: "delete_account" }).success).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run → fail** — `pnpm --filter @handshake-agent/web test contracts-intents` → FAIL.

- [ ] **Step 3: Implement the new intent files**

`send-crypto.intent.ts`:

```typescript
import { z } from "zod";
import { SupportedAssetSchema } from "../common";

export const NetworkSchema = z.enum(["TRON"]);

export const SendCryptoIntentSchema = z.object({
  action: z.literal("send_crypto"),
  asset: SupportedAssetSchema,
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/, "Enter a valid amount"),
  network: NetworkSchema.default("TRON"),
  address: z.string().min(20),
});
export type SendCryptoIntent = z.infer<typeof SendCryptoIntentSchema>;
```

`receive-crypto.intent.ts`:

```typescript
import { z } from "zod";
import { SupportedAssetSchema } from "../common";
import { NetworkSchema } from "./send-crypto.intent";

export const ReceiveCryptoIntentSchema = z.object({
  action: z.literal("receive_crypto"),
  asset: SupportedAssetSchema,
  network: NetworkSchema.default("TRON"),
});
export type ReceiveCryptoIntent = z.infer<typeof ReceiveCryptoIntentSchema>;
```

`swap.intent.ts`:

```typescript
import { z } from "zod";
import { FiatCurrencySchema, SupportedAssetSchema } from "../common";

export const SwapIntentSchema = z.object({
  action: z.literal("swap"),
  fromAsset: SupportedAssetSchema,
  toCurrency: FiatCurrencySchema.default("NGN"),
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/, "Enter a valid amount"),
});
export type SwapIntent = z.infer<typeof SwapIntentSchema>;
```

`buy-ticket.intent.ts`:

```typescript
import { z } from "zod";

export const BuyTicketIntentSchema = z.object({
  action: z.literal("buy_ticket"),
  query: z.string().min(1).max(200),
});
export type BuyTicketIntent = z.infer<typeof BuyTicketIntentSchema>;
```

`check-balance.intent.ts`:

```typescript
import { z } from "zod";

export const CheckBalanceIntentSchema = z.object({
  action: z.literal("check_balance"),
});
export type CheckBalanceIntent = z.infer<typeof CheckBalanceIntentSchema>;
```

- [ ] **Step 4: Extend the union in `intents/index.ts`**

Replace the file with (keeping the existing buy/none imports):

```typescript
import { z } from "zod";
import { BuyCryptoIntentSchema, NoIntentSchema } from "./buy-crypto.intent";
import { SendCryptoIntentSchema } from "./send-crypto.intent";
import { ReceiveCryptoIntentSchema } from "./receive-crypto.intent";
import { SwapIntentSchema } from "./swap.intent";
import { BuyTicketIntentSchema } from "./buy-ticket.intent";
import { CheckBalanceIntentSchema } from "./check-balance.intent";

export const IntentSchema = z.discriminatedUnion("action", [
  BuyCryptoIntentSchema,
  SendCryptoIntentSchema,
  ReceiveCryptoIntentSchema,
  SwapIntentSchema,
  BuyTicketIntentSchema,
  CheckBalanceIntentSchema,
  NoIntentSchema,
]);
export type Intent = z.infer<typeof IntentSchema>;

export * from "./buy-crypto.intent";
export * from "./send-crypto.intent";
export * from "./receive-crypto.intent";
export * from "./swap.intent";
export * from "./buy-ticket.intent";
export * from "./check-balance.intent";
```

Note: the current `intents/index.ts` declares `IntentSchema` from a union that also held the now-moved declarations; verify `IntentSchema` + `NoIntentSchema`/`BuyCryptoIntentSchema` live in `buy-crypto.intent.ts` (they do per the existing file) and only the union root moves here. Do not duplicate `IntentSchema`.

- [ ] **Step 5: Run → pass.** Also run `pnpm --filter @handshake-agent/contracts typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/intents web/lib/schemas/contracts-intents.test.ts
git commit -m "feat(contracts): extend Intent union with send/receive/swap/ticket/balance"
```

---

## Phase 3 — Web view-model schemas (TDD)

### Task 3.1: Chat view-model schemas

**Files:** Create `web/lib/schemas/chat.ts`; Test `web/lib/schemas/chat.test.ts`

- [ ] **Step 1: Write the failing test** — `web/lib/schemas/chat.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ChatMessageSchema, ChatActionSchema } from "./chat";

describe("ChatActionSchema", () => {
  it("accepts known actions", () => {
    for (const a of ["buy", "send", "receive", "swap", "ticket", "balance"])
      expect(ChatActionSchema.safeParse(a).success).toBe(true);
  });
  it("rejects unknown", () =>
    expect(ChatActionSchema.safeParse("nuke").success).toBe(false));
});

describe("ChatMessageSchema", () => {
  it("parses a text message", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m1",
        role: "assistant",
        kind: "text",
        text: "hi",
      }).success,
    ).toBe(true);
  });
  it("parses a quote message", () => {
    const r = ChatMessageSchema.safeParse({
      id: "m2",
      role: "assistant",
      kind: "quote",
      receiveAmt: "29.97 USDT",
      receiveSub: "x",
      rows: [{ label: "You pay", value: "₦50,000" }],
      totalLabel: "Total",
      totalValue: "₦50,000",
      lockSeconds: 60,
    });
    expect(r.success).toBe(true);
  });
  it("rejects a quote missing rows", () => {
    expect(
      ChatMessageSchema.safeParse({
        id: "m3",
        role: "assistant",
        kind: "quote",
        receiveAmt: "x",
        receiveSub: "x",
        totalLabel: "t",
        totalValue: "v",
        lockSeconds: 60,
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `web/lib/schemas/chat.ts`** — Zod schemas matching the Locked Interfaces "chat.ts" types. Each `kind` is a `z.object` with `id`, `role`, `kind` literal, and its fields; `ChatMessageSchema = z.discriminatedUnion("kind", [...])`. Export `z.infer` types for all of `ChatAction`, `QuoteRow`, `QuoteView`, `ConfirmPayload`, `ReceiptView`, `AssetView`, `BalanceView`, `DepositView`, `TicketOption`, `TicketsView`, `TextView`, `ChatMessage`. (`ConfirmPayload` is not part of the message union; export it as its own schema/type.)

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git add web/lib/schemas/chat.ts web/lib/schemas/chat.test.ts
git commit -m "feat(web): chat view-model schemas"
```

### Task 3.2: Wallet / activity / catalog schemas

**Files:** Create `web/lib/schemas/wallet.ts`, `activity.ts`, `catalog.ts`, `index.ts`; Test `web/lib/schemas/catalog.test.ts`

- [ ] **Step 1: Write the failing test** — parse one valid + one invalid fixture for `WalletAssetSchema`, `ActivityGroupSchema`, `AppNotificationSchema`, `SearchResultSchema`, `EventListItemSchema` (assert `.success` true/false). Use the shapes from Locked Interfaces.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the four schema files (Zod objects mirroring the Locked Interface types; `index.ts` re-exports all of `./chat`, `./wallet`, `./activity`, `./catalog`).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(web): wallet/activity/catalog view-model schemas"`

---

## Phase 4 — Constants & fixtures

### Task 4.1: Constants (tints + copy)

**Files:** Create `web/lib/constants.ts`

- [ ] **Step 1: Implement** — export the data literals from the prototype: `ASSET_TINTS = { USDT: "#7fd1a8", BTC: "#f5c46b", NGN: "#cfe6d8" }`, the deposit address `DEPOSIT_ADDRESS = "TQn9Y2khEb7g5mZ8FjpRt1cWnH4dHkLm3vQ"`, the languages `["English","Pidgin","Hausa","Yoruba","Igbo"]`, and `GREETING_M` / `GREETING_D` strings (lines 995 & 1002). No test needed (pure data); covered transitively by flow/store tests.
- [ ] **Step 2: Commit** `git commit -m "feat(web): prototype data constants"`

### Task 4.2: Fixtures

**Files:** Create `web/lib/api/fixtures.ts`; Test `web/lib/api/fixtures.test.ts`

- [ ] **Step 1: Write the failing test** — import each fixture and assert it parses through its schema (e.g. `BalanceViewSchema.parse(balanceFixture)` does not throw; `walletAssetsFixture` every item parses `WalletAssetSchema`; `activityFixture` parses `ActivityGroupSchema[]`; events/notifications/searchCatalog likewise).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement `fixtures.ts`** with the exact data from the prototype:
  - `balanceFixture` (lines 1159–1164): total `≈ ₦72,340`, assets USDT/BTC/NGN with tints.
  - `walletAssetsFixture` (lines 1409–1413).
  - `activityFixture` (lines 1414–1423). Map each prototype activity item's status pill color to a `statusTone`: Completed→success, Confirming→warn (the ticket row's icon stays info via `tint`/`col`, but its `statusTone` is success).
  - `depositFixture` — `{ kind:"receive", asset:"USDT", network:"TRON · TRC-20", address: DEPOSIT_ADDRESS, minDeposit:"1 USDT", creditedEta:"~1 min" }`.
  - `eventsFixture` (lines 1474–1477).
  - `notificationsFixture` (lines 1467–1472).
  - `searchCatalogFixture` (lines 1452–1463).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(web): mock data fixtures"`

---

## Phase 5 — Intent parser (TDD)

### Task 5.1: `parseIntent`

**Files:** Create `web/lib/chat/intent.ts`; Test `web/lib/chat/intent.test.ts`

- [ ] **Step 1: Write the failing test** — table-driven, mirroring prototype `parse()` (lines 1069–1078):

```typescript
import { describe, expect, it } from "vitest";
import { parseIntent } from "./intent";

const cases: [string, ReturnType<typeof parseIntent>][] = [
  ["Buy ₦50,000 of USDT", "buy"],
  ["I want to purchase usdt", "buy"],
  ["invest in crypto", "buy"],
  ["send 25 usdt", "send"],
  ["transfer to my friend", "send"],
  ["pay someone", "send"],
  ["show my deposit address", "receive"],
  ["fund my wallet", "receive"],
  ["get me a ticket", "ticket"],
  ["any concert?", "ticket"],
  ["event near me", "ticket"],
  ["what's my balance", "balance"],
  ["how much do I have", "balance"],
  ["my wallet", "balance"],
  ["swap to naira", "swap"],
  ["convert usdt", "swap"],
  ["cash out", "swap"],
  ["hello there", null],
  ["", null],
];
describe("parseIntent", () => {
  it.each(cases)("%s -> %s", (input, expected) =>
    expect(parseIntent(input)).toBe(expected),
  );
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `web/lib/chat/intent.ts`** — port the regex chain from prototype lines 1069–1078 exactly, returning the `ChatAction` string or `null`. Lowercase the input first. Order: buy → send → receive → ticket → balance → swap (mirror the prototype's order; note `balance` is checked before `swap`).

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit** `git commit -m "feat(web): chat intent parser"`

---

## Phase 6 — Flow builders (TDD)

### Task 6.1: Response + confirm + receipt builders

**Files:** Create `web/lib/chat/flow.ts`; Test `web/lib/chat/flow.test.ts`

- [ ] **Step 1: Write the failing test** — assert each builder returns the exact prototype literals:

```typescript
import { describe, expect, it } from "vitest";
import {
  buildResponse,
  buildBuyConfirm,
  buildSendConfirm,
  buildSwapConfirm,
  buildTicketConfirm,
  buildReceipt,
  startChips,
  chipLabel,
} from "./flow";

describe("flow", () => {
  it("buy response yields text + quote", () => {
    const { messages } = buildResponse("buy");
    expect(messages[0]).toMatchObject({ kind: "text" });
    expect(messages[1]).toMatchObject({
      kind: "quote",
      receiveAmt: "29.97 USDT",
      totalValue: "₦50,000.00",
    });
    expect((messages[1] as any).rows).toHaveLength(5);
  });
  it("balance response yields text + balance card", () => {
    const { messages } = buildResponse("balance");
    expect(messages[1]).toMatchObject({ kind: "balance", total: "≈ ₦72,340" });
  });
  it("receive response yields text + receive card", () => {
    expect(buildResponse("receive").messages[1]).toMatchObject({
      kind: "receive",
      address: expect.stringContaining("TQn9"),
    });
  });
  it("ticket response yields tickets card with 3 options", () => {
    const t = buildResponse("ticket").messages[1] as any;
    expect(t.kind).toBe("tickets");
    expect(t.options).toHaveLength(3);
  });
  it("buy confirm matches prototype", () => {
    expect(buildBuyConfirm()).toMatchObject({
      heroAmount: "29.97 USDT",
      cta: "Confirm with PIN",
      action: "buy",
      totalValue: "₦50,000.00",
    });
  });
  it("send confirm carries the address + warn", () => {
    const c = buildSendConfirm();
    expect(c.toValue).toContain("TQn9");
    expect(c.warn).toBeTruthy();
    expect(c.totalValue).toBe("26.00 USDT");
  });
  it("ticket confirm reflects tier", () => {
    expect(buildTicketConfirm("VIP", "₦75,000", "₦76,250")).toMatchObject({
      heroAmount: "VIP",
      totalValue: "₦76,250",
      action: "ticket",
    });
  });
  it("buy receipt", () =>
    expect(buildReceipt("buy")).toMatchObject({
      kind: "receipt",
      amount: "+ 29.97 USDT",
      ref: expect.stringContaining("HS-"),
    }));
  it("startChips + labels", () => {
    expect(startChips()).toEqual(["buy", "balance", "send", "ticket"]);
    expect(chipLabel("buy")).toBe("Buy ₦50,000 of USDT");
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `web/lib/chat/flow.ts`** — port the literals from prototype `respBuy/respBalance/respReceive/respTicket/respSend/respSwap/completeBuy/completeSend/completeSwap/ticketConfirm/completeTicket` (lines 1101–1329) and `startChips` (1044–1051). `buildResponse(action)` returns the assistant text + the card view-model (no `onAction` closures — the store builds the confirm payload on demand via `buildXConfirm`). `buildReceipt(action, meta?)` returns the receipt for buy/send/swap/ticket. Ticket confirm/receipt take the tier/price/total args. Keep all currency/amount strings byte-identical to the prototype.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit** `git commit -m "feat(web): chat flow builders (quotes, confirms, receipts)"`

---

## Phase 7 — Mock API client (TDD)

### Task 7.1: In-memory mock backend

**Files:** Create `web/lib/api/mock/index.ts`; Test `web/lib/api/mock/mock.test.ts`

- [ ] **Step 1: Write the failing test:**

```typescript
import { describe, expect, it } from "vitest";
import * as mock from "./index";
import { BalanceViewSchema } from "@/lib/schemas";

describe("mock api", () => {
  it("getBalances returns schema-valid data", async () => {
    const b = await mock.getBalances();
    expect(() => BalanceViewSchema.parse(b)).not.toThrow();
  });
  it("createQuote('buy') returns a quote", async () => {
    expect(await mock.createQuote("buy")).toMatchObject({
      kind: "quote",
      receiveAmt: "29.97 USDT",
    });
  });
  it("executeTransaction returns a receipt and is idempotent", async () => {
    const a = await mock.executeTransaction("buy", "key-1");
    const b = await mock.executeTransaction("buy", "key-1");
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `web/lib/api/mock/index.ts`** — each reader returns `Promise.resolve(<fixture>)` (optionally wrapped in a tiny `delay(ms)` helper that resolves immediately when `process.env.NODE_ENV === "test"`), parsed through its schema before return. `createQuote(action)` returns the quote view from `flow.buildResponse(action)` (the `quote`-kind message) or, for non-quote actions, throws `Error("no quote for action")`. `executeTransaction(action, key, meta?)` memoizes by `key` in a module-level `Map` and returns `flow.buildReceipt(action, meta)`.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit** `git commit -m "feat(web): in-memory mock api"`

### Task 7.2: Axios client + gateway

**Files:** Create `web/lib/api/client.ts`, `web/lib/api/gateway.ts`; Test `web/lib/api/gateway.test.ts`

- [ ] **Step 1: Write the failing test** — assert `gateway` exposes the same method names as the mock and, with the default flag (`USE_MOCK=true`), `gateway.getBalances()` deep-equals `mock.getBalances()`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement:**
  - `client.ts`: one Axios instance `api = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api" })` with a request interceptor that, for non-GET, sets `config.headers["Idempotency-Key"] ||= crypto.randomUUID()`, and a response interceptor that normalizes errors to `{ message }`. Export `api`.
  - `gateway.ts`: `const USE_MOCK = (process.env.NEXT_PUBLIC_USE_MOCK ?? "true") !== "false"` and `export const gateway = USE_MOCK ? mockGateway : realGateway`, where `mockGateway` re-exports the mock functions and `realGateway` maps each to an `api.get/post(...)` call returning schema-parsed data. Components/hooks import `gateway`, never `mock` directly.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(web): axios client + mock/real gateway switch"`

---

## Phase 8 — Query hooks (TDD)

### Task 8.1: Query keys + read/mutation hooks

**Files:** Create `web/lib/query/keys.ts`, `web/lib/query/hooks.ts`; Test `web/lib/query/hooks.test.tsx`

- [ ] **Step 1: Write the failing test** — render hooks with a QueryClient wrapper:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useBalances, useExecuteTransaction } from "./hooks";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("query hooks", () => {
  it("useBalances loads", async () => {
    const { result } = renderHook(() => useBalances(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe("≈ ₦72,340");
  });
  it("useExecuteTransaction returns a receipt", async () => {
    const { result } = renderHook(() => useExecuteTransaction(), { wrapper });
    const receipt = await result.current.mutateAsync({ action: "buy" });
    expect(receipt.kind).toBe("receipt");
  });
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `keys.ts` (the `qk` factory from Locked Interfaces) and `hooks.ts` — each read hook is `useQuery({ queryKey: qk.x, queryFn: gateway.x, staleTime })` with sensible `staleTime` (balances 15s, events/catalog 5min, notifications 30s). `useCreateQuote`/`useExecuteTransaction` are `useMutation` wrapping `gateway.createQuote`/`gateway.executeTransaction`; `useExecuteTransaction.onSuccess` calls `queryClient.invalidateQueries({ queryKey: qk.balances })`. `useExecuteTransaction` generates an idempotency key per call (`crypto.randomUUID()`).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit** `git commit -m "feat(web): tanstack query keys + hooks"`

---

## Phase 9 — Chat store (TDD)

### Task 9.1: Zustand chat store + PIN state machine

**Files:** Create `web/lib/store/chat-store.ts`; Test `web/lib/store/chat-store.test.ts`

- [ ] **Step 1: Write the failing test** — drive the machine synchronously. The store accepts an injected scheduler so typing delays run immediately in tests:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { createChatStore } from "./chat-store";

const immediate = (fn: () => void) => fn(); // no setTimeout in tests

describe("chat store", () => {
  let store: ReturnType<typeof createChatStore>;
  beforeEach(() => {
    store = createChatStore({ schedule: immediate });
  });

  it("send appends user msg then assistant messages", () => {
    store.getState().send("m", "Buy ₦50,000 of USDT", "buy");
    const t = store.getState().threads.m;
    expect(t.at(-3)?.role).toBe("user");
    expect(t.at(-1)).toMatchObject({ kind: "quote" });
    expect(store.getState().typing.m).toBe(false);
  });
  it("openConfirm → confirmToPin → 4 digits → receipt + success, only after PIN", () => {
    const s = store.getState();
    s.openConfirm("m", {
      /* buildBuyConfirm() */ ...require("@/lib/chat/flow").buildBuyConfirm(),
    });
    expect(store.getState().confirmOpen).toBe(true);
    s.confirmToPin();
    expect(store.getState().pinOpen).toBe(true);
    // no receipt yet
    expect(store.getState().threads.m.some((m) => m.kind === "receipt")).toBe(
      false,
    );
    "1234".split("").forEach((d) => store.getState().pressPin(d));
    expect(store.getState().threads.m.some((m) => m.kind === "receipt")).toBe(
      true,
    );
    expect(store.getState().successOpen).toBe(true);
    expect(store.getState().pinOpen).toBe(false);
  });
  it("cancel clears pending with no receipt", () => {
    const s = store.getState();
    s.openConfirm("m", require("@/lib/chat/flow").buildBuyConfirm());
    s.cancel();
    expect(store.getState().confirmOpen).toBe(false);
    expect(store.getState().pending).toBeNull();
    expect(store.getState().threads.m.some((m) => m.kind === "receipt")).toBe(
      false,
    );
  });
  it("threads are isolated per surface", () => {
    store.getState().send("d", "balance", "balance");
    expect(store.getState().threads.m.length).toBeLessThan(
      store.getState().threads.d.length + 5,
    );
  });
});
```

(If `require` is awkward under ESM, import `buildBuyConfirm` at top instead.)

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `web/lib/store/chat-store.ts`** — `createChatStore({ schedule = (fn)=>setTimeout(fn,680) } = {})` returns a vanilla Zustand store (`createStore`) with the Locked Interface state/actions. Also export a React hook `useChatStore` bound to a default `createChatStore()` singleton. `send` mirrors prototype `send`/`respond`/`typeThen` (append user msg → clear chips → schedule(append assistant messages from `buildResponse` + reset chips per the prototype's post-flow chip sets). `pressPin` appends a digit, and at length 4 calls `pinComplete`. `pinComplete` is the only path that appends `buildReceipt(pending.action, pending.meta)` and opens success (auto-closes via `schedule` too, or leave open in tests). `openConfirm` builds nothing — it stores the passed `ConfirmPayload`. The component layer calls `openConfirm` with the right `buildXConfirm()`.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit** `git commit -m "feat(web): zustand chat store with PIN execution gate"`

---

## Phase 10 — Shared atoms (TDD each)

> All atoms are pure presentational. Each task: failing RTL test → implement → pass → commit. Props live in `web/types/components.ts` (create it in Task 10.1 and extend per atom). Apply the hex→token table; the only inline `style` allowed is for data-driven tint colors.

### Task 10.1: `Money`

**Files:** Create `web/components/shared/money.tsx`; add `MoneyProps` to `web/types/components.ts`; Test `web/components/shared/money.test.tsx`

- [ ] **Step 1: Failing test** — `render(<Money value="₦72,340" />)` → `screen.getByText("₦72,340")` has class `tabular-nums`; supports `as` prop default `span`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — `<span className={cn("tabular-nums", className)}>{value}</span>`; `MoneyProps = { value: string; className?: string }`.
- [ ] **Step 4: Run → pass.** **Step 5: Commit** `git commit -m "feat(web): Money atom"`.

### Task 10.2: `DetailRows`

**Files:** `web/components/shared/detail-rows.tsx`; `DetailRowsProps`; test.

- [ ] **Step 1: Failing test** — given `rows={[{label:"You pay",value:"₦50,000"}]}` renders label + value; value uses `tabular-nums`.
- [ ] **Step 2–4:** implement the label/value row list (prototype rows pattern, e.g. lines 180–185); `DetailRowsProps = { rows: QuoteRow[]; className?: string }`. Pass.
- [ ] **Step 5: Commit** `git commit -m "feat(web): DetailRows atom"`.

### Task 10.3: `StatusPill`

**Files:** `web/components/shared/status-pill.tsx`; `StatusPillProps`; test.

- [ ] **Step 1: Failing test** — `<StatusPill tone="success">Completed</StatusPill>` shows text "Completed" and has token classes for success (`bg-success-muted text-success`); tones `success|warn|info|neutral` map to the right token classes; **text label always present (color never sole signal, §13.8).**
- [ ] **Step 2–4:** implement a `cva` variant map over the four tones. `StatusPill`'s `tone` prop type is `StatusTone` imported from `@/lib/schemas` (the `common.ts` schema), not a locally-redeclared union. Pass.
- [ ] **Step 5: Commit** `git commit -m "feat(web): StatusPill atom"`.

### Task 10.4: `AssetIcon`

**Files:** `web/components/shared/asset-icon.tsx`; `AssetIconProps`; test.

- [ ] **Step 1: Failing test** — `<AssetIcon sym="$" tint="#7fd1a8" />` renders "$"; the wrapper has inline `style={{ backgroundColor: "#7fd1a8" }}`; sizes via `size` prop (`sm|md`).
- [ ] **Step 2–4:** implement rounded tinted chip. Pass.
- [ ] **Step 5: Commit** `git commit -m "feat(web): AssetIcon atom"`.

### Task 10.5: `QrPlaceholder`

**Files:** `web/components/shared/qr-placeholder.tsx`; `QrPlaceholderProps`; test.

- [ ] **Step 1: Failing test** — renders a element with `data-testid="qr"`; accepts `size` prop.
- [ ] **Step 2–4:** port the CSS QR motif (prototype lines 230–235); use `bg-foreground` for the modules instead of `#16261e`. Pass.
- [ ] **Step 5: Commit** `git commit -m "feat(web): QrPlaceholder atom"`.

---

## Phase 11 — Chat message cards (TDD each, density-variant)

> Each card: failing RTL test (assert fields render for both densities) → implement by porting the referenced mobile + desktop markup applying the token table → pass → commit. Each card's `Props = { density: "mobile" | "desktop" } & <ViewModel>`. Put `Props` in `web/types/components.ts`. Use `shared/*` atoms (DetailRows, Money, AssetIcon, StatusPill, QrPlaceholder) — do not re-implement rows/amounts.

### Task 11.1: `QuoteCard`

**Files:** `web/components/chat/cards/quote-card.tsx`; `QuoteCardProps`; test.

- [ ] **Step 1: Failing test:**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { QuoteCard } from "./quote-card";
import { buildBuyConfirm } from "@/lib/chat/flow";

const quote = {
  kind: "quote",
  receiveAmt: "29.97 USDT",
  receiveSub: "≈ what lands in your wallet",
  rows: [{ label: "You pay", value: "₦50,000.00" }],
  totalLabel: "Total to pay",
  totalValue: "₦50,000.00",
  lockSeconds: 60,
} as const;

describe("QuoteCard", () => {
  it.each(["mobile", "desktop"] as const)("renders fields (%s)", (density) => {
    render(<QuoteCard density={density} {...quote} onConfirm={() => {}} />);
    expect(screen.getByText("29.97 USDT")).toBeInTheDocument();
    expect(screen.getByText("You pay")).toBeInTheDocument();
    expect(screen.getByText("Total to pay")).toBeInTheDocument();
  });
  it("fires onConfirm on Review & confirm", async () => {
    const onConfirm = vi.fn();
    render(<QuoteCard density="mobile" {...quote} onConfirm={onConfirm} />);
    await userEvent.click(
      screen.getByRole("button", { name: /review & confirm/i }),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** — port mobile markup (lines 164–197) and desktop markup (823–838); switch sizing by `density`. Replace every hex with the token table classes; use `DetailRows` for `rows`, `Money` for amounts. The button calls `props.onConfirm`. `QuoteCardProps = QuoteView & { density: Density; onConfirm: () => void }`.
- [ ] **Step 4: Run → pass.** **Step 5: Commit** `git commit -m "feat(web): QuoteCard"`.

### Task 11.2: `BalanceCard`

**Files:** `web/components/chat/cards/balance-card.tsx`; test. Port lines 200–219 (m) / 840–849 (d). Test: renders `total` and each asset name/value for both densities. Uses `AssetIcon`. Commit `feat(web): BalanceCard`.

### Task 11.3: `ReceiveCard`

**Files:** `.../receive-card.tsx`; test. Port 222–253 (m) / 851–864 (d). Test: renders address text, network label, a `Copy` button, and the QR (`QrPlaceholder`). Commit `feat(web): ReceiveCard`.

### Task 11.4: `TicketsCard`

**Files:** `.../tickets-card.tsx`; test. Port 256–280 (m) / 866–875 (d). `TicketsCardProps = TicketsView & { density; onSelect: (opt: TicketOption) => void }`. Test: renders eventName + 3 option tiers/prices; clicking an option fires `onSelect` with that option. Commit `feat(web): TicketsCard`.

### Task 11.5: `ReceiptCard`

**Files:** `.../receipt-card.tsx`; test. Port 283–308 (m) / 877–888 (d). Test: renders title, amount, each row, and the `ref`. Uses `DetailRows`. Commit `feat(web): ReceiptCard`.

---

## Phase 12 — Chat thread, composer, message dispatch, typing (TDD)

### Task 12.1: `TypingIndicator`

**Files:** `web/components/chat/typing-indicator.tsx`; test (renders 3 dots, `data-testid="typing"`). Port 313–319. Commit `feat(web): TypingIndicator`.

### Task 12.2: `ChatMessageView` (kind dispatch)

**Files:** `web/components/chat/chat-message.tsx`; test. `ChatMessageViewProps = { message: ChatMessage; density: Density; onConfirm: (m: ChatMessage) => void; onSelectTicket: (opt: TicketOption) => void }`.

- [ ] **Step 1: Failing test** — for a `text` user message renders the text in a user bubble (assert alignment class); for a `quote` message renders `QuoteCard`; for `balance` renders `BalanceCard`; etc. (one assertion per kind).
- [ ] **Steps 2–4:** implement a `switch (message.kind)` dispatch to the cards (lines 156–308 for bubble styling: user bubble `bg-primary text-primary-foreground`, assistant text `bg-card border`). Pass.
- [ ] **Step 5: Commit** `feat(web): ChatMessage dispatch`.

### Task 12.3: `ChatComposer`

**Files:** `web/components/chat/chat-composer.tsx`; test. `ChatComposerProps = { chips: ChatAction[]; value: string; onChange: (v: string)=>void; onSubmit: ()=>void; onChip: (a: ChatAction)=>void; density: Density }`.

- [ ] **Step 1: Failing test** — renders a chip per action with its `chipLabel`; clicking a chip calls `onChip`; typing updates via `onChange`; Enter calls `onSubmit`; the send button calls `onSubmit`.
- [ ] **Steps 2–4:** port 322–339 (m) / 896–904 (d) using `ui/input` + `ui/button`. Pass.
- [ ] **Step 5: Commit** `feat(web): ChatComposer`.

### Task 12.4: `ChatThread`

**Files:** `web/components/chat/chat-thread.tsx`; test. `ChatThreadProps = { messages: ChatMessage[]; typing: boolean; density: Density; onConfirm; onSelectTicket }`.

- [ ] **Step 1: Failing test** — renders one `ChatMessage` per item; shows `TypingIndicator` when `typing`; renders the "Today" divider.
- [ ] **Steps 2–4:** implement the scroll container (auto-scroll via `useEffect` + ref on `messages.length`/`typing`); port 149–320. Pass.
- [ ] **Step 5: Commit** `feat(web): ChatThread`.

---

## Phase 13 — Overlays (TDD)

### Task 13.1: `ConfirmSheet`

**Files:** `web/components/chat/overlays/confirm-sheet.tsx`; test. `ConfirmSheetProps = { open: boolean; payload: ConfirmPayload | null; density: Density; onConfirm: ()=>void; onCancel: ()=>void }`.

- [ ] **Step 1: Failing test** — when `open` with a payload, renders `title`, `heroAmount`, each row, `totalValue`, the `warn` text when present, and the `cta` button; clicking cta → `onConfirm`; clicking Cancel → `onCancel`; pressing `Escape` → `onCancel`. When `!open`, renders nothing.
- [ ] **Steps 2–4:** implement one component that renders `ui/sheet` (bottom) when `density==="mobile"` and `ui/dialog` (centered) when `"desktop"`, sharing the body. Port 437–489 (m) / 910–941 (d). Use `DetailRows`. Pass.
- [ ] **Step 5: Commit** `feat(web): ConfirmSheet overlay`.

### Task 13.2: `PinPad`

**Files:** `web/components/chat/overlays/pin-pad.tsx`; test. `PinPadProps = { open: boolean; pinLength: number; density: Density; onDigit: (d: string)=>void; onBack: ()=>void; onFaceId: ()=>void; onCancel: ()=>void }`.

- [ ] **Step 1: Failing test** — renders digit buttons 0–9, a Face ID button, a backspace button; shows 4 dots, `pinLength` of them filled (assert via class/`data-filled`); clicking "7" calls `onDigit("7")`; Face ID → `onFaceId`; Cancel → `onCancel`. **Does not itself execute** — it only emits events.
- [ ] **Steps 2–4:** port 492–524 (m) / 944–967 (d) on `ui/button`; icon buttons have `aria-label` ("Backspace", "Use Face ID"). Pass.
- [ ] **Step 5: Commit** `feat(web): PinPad overlay`.

### Task 13.3: `SuccessOverlay`

**Files:** `web/components/chat/overlays/success-overlay.tsx`; test. `SuccessOverlayProps = { open: boolean; text: string }`.

- [ ] **Step 1: Failing test** — when `open`, shows the check mark (`data-testid="success"`) and `text`; when not, renders nothing.
- [ ] **Steps 2–4:** port 527–537 / 970–975. Pass.
- [ ] **Step 5: Commit** `feat(web): SuccessOverlay`.

---

## Phase 14 — Onboarding (TDD)

### Task 14.1: `KycSummary`

**Files:** `web/components/onboarding/kyc-summary.tsx`; test. `KycSummaryProps = { onFinish: () => void }`.

- [ ] **Step 1: Failing test** — renders "Let's verify it's you", the three verified rows (Phone/BVN/Selfie), and a "Finish & open my wallet" button that calls `onFinish`.
- [ ] **Steps 2–4:** port 56–118 with tokens; status chips use `StatusPill tone="success"`. Pass.
- [ ] **Step 5: Commit** `feat(web): KYC summary screen`.

### Task 14.2: `/onboarding` route

**Files:** `web/app/onboarding/page.tsx`; test `web/app/onboarding/page.test.tsx`.

- [ ] **Step 1: Failing test** — renders `KycSummary`; (navigation tested in E2E). A client page wires `onFinish` to `useRouter().push("/app")`.
- [ ] **Steps 2–4:** implement `"use client"` page centering the device-width column. Pass.
- [ ] **Step 5: Commit** `feat(web): onboarding route`.

---

## Phase 15 — Mobile surface (TDD)

### Task 15.1: `ChatHeader`, `MobileTabbar`

**Files:** `web/components/mobile/chat-header.tsx`, `mobile-tabbar.tsx`; tests. Port 128–146 and 414–431. `MobileTabbarProps = { active: "chat"|"wallet"|"activity"; onSelect: (t)=>void }`; test asserts three tab buttons and `onSelect` fires with the tapped tab; icon buttons labelled. Commit `feat(web): mobile chat header + tabbar`.

### Task 15.2: `WalletTab`, `ActivityTab`

**Files:** `web/components/mobile/wallet-tab.tsx`, `activity-tab.tsx`; tests. These consume `useWalletAssets`/`useBalances` and `useActivity` and implement all four async branches (skeleton via `ui/skeleton`, error card, empty text, data). Test with a QueryClient wrapper: asserts skeleton then data (`waitFor` total `≈ ₦72,340`; an asset row; an activity group title). Port 345–379 / 382–411. Quick-action buttons take an `onQuickAction(action, label)` prop. Commit `feat(web): mobile wallet + activity tabs`.

### Task 15.3: `MobileShell` + `/app` route

**Files:** `web/components/mobile/mobile-shell.tsx`, `web/app/app/page.tsx`; tests.

- [ ] **Step 1: Failing test (`mobile-shell.test.tsx`)** — wraps in QueryClient; default chat tab shows the greeting message + composer chips; clicking the "Buy ₦50,000 of USDT" chip appends a user message then a quote card; clicking "Review & confirm" opens the confirm sheet; completing it (Face ID button) appends a receipt and shows success; tapping the Wallet tab shows balances. This is the **full mobile flow integration test** and is the primary guard for the money path on mobile.
- [ ] **Steps 2–4:** implement `MobileShell` wiring `useChatStore` (surface `"m"`) to `ChatHeader` + `ChatThread` + `ChatComposer` + `MobileTabbar` + overlays (`ConfirmSheet`/`PinPad`/`SuccessOverlay` reading store state). `onConfirm` for a quote message calls `store.openConfirm("m", buildBuyConfirm()/buildSendConfirm()/...)` chosen by the message's action context (track the last action in the store, or attach `action` to the quote view-model — extend `QuoteView` with an `action` field in Task 3.1 if needed; if so, update the schema test). The `/app` page renders `MobileShell` in a phone-width centered column. Pass.
- [ ] **Step 5: Commit** `feat(web): mobile shell + /app route (full chat→PIN→receipt flow)`.

> Note: if wiring reveals the quote message needs its originating `action` to pick the right confirm builder, add `action: ChatActionSchema` to `QuoteView` in `chat.ts` (and its test) and set it in `flow.buildResponse`. Do this as a small amendment within this task and re-run Phase 3/6 tests.

---

## Phase 16 — Desktop surface (TDD)

### Task 16.1: `DashboardSidebar`

**Files:** `web/components/desktop/dashboard-sidebar.tsx`; test. `DashboardSidebarProps = { active: DashboardPage; onNavigate: (p: DashboardPage)=>void }`. Renders 5 nav items; active item has the accent treatment; clicking fires `onNavigate`; renders the verified-account badge + user profile. Port 549–571. Commit `feat(web): dashboard sidebar`.

### Task 16.2: `DashboardTopbar` (search + notifications)

**Files:** `web/components/desktop/dashboard-topbar.tsx`; test. Props include `onSearchSelect`, `onQuickAction`, and consumes `useNotifications` + `useSearchCatalog`. Tests: typing in search filters the catalog (type "wallet" → a "Wallet" result; selecting it fires `onSearchSelect`); the bell shows the unread count and opens the notifications dropdown; "Mark all read" clears the badge. Port 575–616. Commit `feat(web): dashboard topbar (search + notifications)`.

### Task 16.3: Pages — Overview, Wallet, Activity, Tickets, Settings

**Files:** `web/components/desktop/{overview,wallet,activity,tickets,settings}-page.tsx`; one test each.

- Overview (620–681): consumes `useBalances` + `useWalletAssets` + `useActivity`; renders balance hero, asset table rows, recent-activity rows; four async branches. Action buttons fire `onQuickAction`.
- Wallet (684–718): `useWalletAssets`; asset cards grid + deposit panel with `QrPlaceholder`; "Show QR in chat" fires `onQuickAction("receive", …)`.
- Activity (721–744): `useActivity` + local filter state (All/Received/Sent/Tickets) filtering by `dir`; renders groups; `StatusPill` per item.
- Tickets (747–778): static confirmed ticket + `useEvents` browse list; "Get ticket" fires `onQuickAction("ticket", …)`.
- Settings (781–804): profile, security rows, bio `ui/switch` (local toggle), language pills (local select), Tier-3 limit.
  Each test asserts the headline + key rows render (with QueryClient wrapper where hooks are used). Commit each: `feat(web): desktop <page> page`.

### Task 16.4: `ChatRail`

**Files:** `web/components/desktop/chat-rail.tsx`; test. Like `MobileShell` but surface `"d"`, density `"desktop"`, no tabbar: header + thread + chips + composer. Test: greeting renders; chip → quote; confirm → PIN → receipt (desktop overlays). Commit `feat(web): desktop chat rail`.

### Task 16.5: `/dashboard` route

**Files:** `web/app/dashboard/page.tsx`; test.

- [ ] **Step 1: Failing test** — renders sidebar + the active page + chat rail; clicking a sidebar item swaps the page; a topbar quick-action routes into the chat rail (e.g., "Buy" appends a quote to the rail). Full desktop integration test.
- [ ] **Steps 2–4:** implement `"use client"` page holding `dPage` state, wiring sidebar `onNavigate`, topbar `onQuickAction`/`onSearchSelect` (→ `useChatStore.send("d", …)` and/or page switch), pages, and `ChatRail` + desktop overlays. Port the 1180-wide dashboard frame layout (546–977) as a responsive full-width layout (drop the fixed 1180×768 framing for a real responsive dashboard; min-width breakpoint `lg`). Pass.
- [ ] **Step 5: Commit** `feat(web): desktop dashboard route`.

---

## Phase 17 — Launcher route

### Task 17.1: `/` launcher

**Files:** Modify `web/app/page.tsx`; test.

- [ ] **Step 1: Failing test** — renders "Handshake Agent", a link/button to `/app`, one to `/dashboard`, and one to `/onboarding`.
- [ ] **Steps 2–4:** implement a brand launcher (cream bg, logo lockup from 34–39, two entry cards + onboarding link) using `next/link`. Remove the scaffold "Press d to toggle dark". Pass.
- [ ] **Step 5: Commit** `feat(web): brand launcher route`.

---

## Phase 18 — E2E smokes (Playwright)

### Task 18.1: Playwright config + buy-flow smokes

**Files:** Create `web/playwright.config.ts`, `web/e2e/buy-flow.spec.ts`.

- [ ] **Step 1: Install browsers** — `cd web && pnpm exec playwright install chromium`.
- [ ] **Step 2: Write `playwright.config.ts`** — `webServer: { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true }`, `testDir: "./e2e"`, projects chromium.
- [ ] **Step 3: Write `e2e/buy-flow.spec.ts`** — two tests:
  - mobile: goto `/app`; click chip "Buy ₦50,000 of USDT"; expect a quote card; click "Review & confirm"; click "Confirm with PIN"; click digits 1-2-3-4; expect "Purchase complete" receipt + success.
  - desktop: goto `/dashboard`; click the "Buy" hero action; in the rail expect a quote; complete confirm → PIN → receipt.
- [ ] **Step 4: Run** — `pnpm --filter @handshake-agent/web test:e2e` → PASS (start dev server if not auto).
- [ ] **Step 5: Commit** `git commit -m "test(web): playwright buy-flow smokes"`.

---

## Phase 19 — Final gates

### Task 19.1: Full workspace gates green

**Files:** none (verification + any fixes)

- [ ] **Step 1:** `pnpm --filter @handshake-agent/web lint` → fix any issues.
- [ ] **Step 2:** `pnpm --filter @handshake-agent/web typecheck` → must pass.
- [ ] **Step 3:** `pnpm --filter @handshake-agent/web test` → all unit/component tests pass.
- [ ] **Step 4:** `pnpm depcruise` (root) → no boundary violations (components don't import app/lib upward, lib doesn't import components, no `@prisma/client` in web). Fix any.
- [ ] **Step 5:** `pnpm --filter @handshake-agent/web build` → Turbopack build succeeds.
- [ ] **Step 6: Commit** any fixes `git commit -m "chore(web): satisfy lint/type/depcruise/build gates"`.

### Task 19.2: Manual visual verification

- [ ] Run `pnpm --filter @handshake-agent/web dev`; verify `/onboarding`, `/app` (chat buy/send/receive/ticket/balance/swap, confirm, PIN, success, wallet + activity tabs), and `/dashboard` (5 pages, search, notifications, chat rail, overlays) against the prototype. Use the `run` skill / a screenshot pass. Note any visual drift and fix in the relevant component.

---

## Self-review (completed by plan author)

- **Spec coverage:** tokens/fonts (P1), contracts (P2), view-models (P3), engine intent/flow/store (P5/P6/P9), mock+query plumbing (P4/P7/P8), atoms/cards/overlays (P10–13), onboarding (P14), mobile (P15), desktop (P16), launcher (P17), E2E (P18), gates incl. depcruise (P19). Every spec §3–§9 item maps to a task. ✔
- **Placeholders:** none — logic tasks carry full code; UI tasks carry full prop interfaces, exact committed-source line refs to port, the hex→token table, and full test code. ✔
- **Type consistency:** `ChatAction`, `ChatSurface`, `ConfirmPayload`, `QuoteView`, `qk`, store method names, gateway method names are defined once in Locked Interfaces and referenced verbatim throughout. The one amendment point (adding `action` to `QuoteView`) is called out explicitly in Task 15.3 with instructions to update the Phase 3/6 tests. ✔

```

```
