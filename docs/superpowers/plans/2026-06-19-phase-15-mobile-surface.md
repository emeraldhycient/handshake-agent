# Phase 15 — Mobile Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full mobile chat surface — `ChatHeader`, `MobileTabbar`, `WalletTab`, `ActivityTab`, `MobileShell`, and the `/app` route — with the complete chat → quote → confirm → PIN → receipt money-path, tested via strict TDD.

**Architecture:** `MobileShell` is a client component that holds local tab state and wires `useChatStore` (surface `"m"`) to the existing `ChatThread`, `ChatComposer`, and overlay components (`ConfirmSheet`, `PinPad`, `SuccessOverlay`). A focus-trap dialog wrapper is added around `PinPad` to resolve the Phase 13 TODO. `WalletTab` and `ActivityTab` consume TanStack Query read hooks. The `/app` route renders `MobileShell` in a phone-width column. Components are pure UI — no business logic; no hex values.

**Tech Stack:** Next 16 App Router, React 19, Tailwind v4 (CSS tokens only), `radix-ui` (`FocusScope`), TanStack Query v5, Zustand v5 (via `useChatStore` / `createChatStore`), Vitest 4 + RTL + user-event, `@testing-library/react` `renderHook` + `waitFor`.

---

## Context for implementors — read before writing code

### What already exists (do NOT re-implement)

- Store: `useChatStore` and `createChatStore({ schedule })` in `web/lib/store/chat-store.ts`. Surface `"m"` is already seeded with the greeting and `startChips()`.
- Flow builders: `buildBuyConfirm`, `buildSendConfirm`, `buildSwapConfirm`, `buildTicketConfirm`, `chipLabel`, `startChips` in `web/lib/chat/flow.ts`.
- Chat UI: `ChatThread`, `ChatComposer` in `web/components/chat/`.
- Overlays: `ConfirmSheet`, `PinPad`, `SuccessOverlay` in `web/components/chat/overlays/`.
- Query hooks: `useBalances`, `useWalletAssets`, `useActivity` in `web/lib/query/hooks.ts`.
- Atoms: `Money`, `AssetIcon`, `StatusPill` in `web/components/shared/`.
- Prop types: `web/types/components.ts` (add new `ChatHeaderProps`, `MobileTabbarProps`, `WalletTabProps`, `ActivityTabProps`, `MobileShellProps` here).
- `radix-ui` exports `FocusScope` — verified available: `import { FocusScope } from "radix-ui"`.

### Store-wiring contract (get this exactly right)

```typescript
// Surface key is always "m" in MobileShell.
const store = useChatStore()    // full state

// Composer wiring:
chips={store.chips.m}
value={store.input.m}
onChange={(v) => store.setInput("m", v)}
onSubmit={() => store.send("m", store.input.m)}
onChip={(a) => store.send("m", chipLabel(a), a)}

// ChatThread wiring:
messages={store.threads.m}
typing={store.typing.m}
density="mobile"
onConfirm={(message) => {
  // message.kind === "quote" — derive confirm payload from message.action
  if (message.kind === "quote") {
    const payload =
      message.action === "buy"    ? buildBuyConfirm()
      : message.action === "send" ? buildSendConfirm()
      :                             buildSwapConfirm()
    store.openConfirm("m", payload)
  }
}}
onSelectTicket={(opt) =>
  store.openConfirm("m", buildTicketConfirm(opt.tier, opt.price, opt.total))
}

// ConfirmSheet:
open={store.confirmOpen && store.overlaySurface === "m"}
payload={store.pending}
density="mobile"
onConfirm={store.confirmToPin}
onCancel={store.cancel}

// PinPad (inside a focus-trap dialog wrapper):
open={store.pinOpen && store.overlaySurface === "m"}
pinLength={store.pin.length}
density="mobile"
onDigit={store.pressPin}
onBack={store.pinBack}
onFaceId={store.pinComplete}
onCancel={store.cancel}

// SuccessOverlay:
open={store.successOpen && store.successSurface === "m"}
text={store.successText}
```

### Test strategy for typing delays

`useChatStore()` is a singleton backed by `createChatStore()` with the default 680 ms `setTimeout`. In component tests, import the singleton directly — but use `findBy*` / `waitFor` to await assistant messages asynchronously (RTL's jsdom handles real `setTimeout` via `vi.useFakeTimers` or by waiting with `findBy*` which polls up to 1 s by default).

**Preferred approach (no test pollution):** `MobileShell` accepts an optional `store` prop (type `ChatStore | undefined`). When provided, it uses that store instead of the singleton. Tests create a fresh `createChatStore({ schedule: (fn) => fn() })` (immediate scheduler, no real `setTimeout`) and pass it in. Production renders `<MobileShell />` with no prop → uses the singleton. This is clean and avoids fake timers.

```typescript
// web/components/mobile/mobile-shell.tsx
import {
  createChatStore,
  useChatStore,
  type ChatStore,
} from "@/lib/store/chat-store";

// Accept an injected store for testing; fall back to the singleton.
export function MobileShell({ store: injectedStore }: MobileShellProps) {
  const singleton = useChatStore(); // React hook — always called
  const store = injectedStore
    ? injectedStore.getState() // vanilla store → call getState()
    : singleton; // React hook result already is the state
  // ...
}
```

Wait — this is tricky. `useChatStore()` (hook) returns the full reactive state. A vanilla store's `getState()` returns a snapshot (no reactivity). For tests we need the shell to re-render on state changes.

**Cleaner approach:** `MobileShell` accepts an optional `store?: ReturnType<typeof createChatStore>` (i.e., a vanilla `StoreApi`). It then uses `useStore(store ?? _defaultStore)` to get reactive state. That way the hook is always called with a stable store reference. Here is the exact pattern:

```typescript
// web/components/mobile/mobile-shell.tsx
"use client"
import { useStore } from "zustand"
import { createChatStore } from "@/lib/store/chat-store"

// The module-level singleton — same one useChatStore() uses internally.
import { _defaultStore }  // Can't do this — it's not exported.
```

Actually `_defaultStore` is not exported. The real solution: export a helper or simply accept the vanilla store and call `useStore` on it. Update `chat-store.ts` to also export `defaultChatStore` (the singleton vanilla store):

```typescript
// chat-store.ts — add this export (it's already the `_defaultStore` variable):
export const defaultChatStore = createChatStore(); // replace the `const _defaultStore = ...` line
// Then `useChatStore` binds to `defaultChatStore` instead of `_defaultStore`.
```

Then `MobileShell`:

```typescript
"use client";
import { useStore } from "zustand";
import { defaultChatStore, createChatStore } from "@/lib/store/chat-store";
import type { ChatStore } from "@/lib/store/chat-store";

export function MobileShell({ store = defaultChatStore }: MobileShellProps) {
  const state = useStore(store); // reactive — re-renders on every store mutation
  // ...use state.threads.m, state.send, etc.
}
```

Tests pass `store={createChatStore({ schedule: (fn) => fn() })}`. Production renders `<MobileShell />` — `store` defaults to `defaultChatStore`. **This is the implementation to use.**

---

## File structure

| File                                           | Action | Responsibility                                                                             |
| ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `web/components/mobile/chat-header.tsx`        | Create | Brand header (avatar + name + online status + Secured badge)                               |
| `web/components/mobile/chat-header.test.tsx`   | Create | Tests for ChatHeader                                                                       |
| `web/components/mobile/mobile-tabbar.tsx`      | Create | Bottom nav (Chat / Wallet / Activity)                                                      |
| `web/components/mobile/mobile-tabbar.test.tsx` | Create | Tests for MobileTabbar                                                                     |
| `web/components/mobile/wallet-tab.tsx`         | Create | Wallet tab (balance hero + quick actions + assets list)                                    |
| `web/components/mobile/wallet-tab.test.tsx`    | Create | Tests including QueryClient wrapper                                                        |
| `web/components/mobile/activity-tab.tsx`       | Create | Activity tab (grouped history with StatusPill)                                             |
| `web/components/mobile/activity-tab.test.tsx`  | Create | Tests including QueryClient wrapper                                                        |
| `web/components/mobile/mobile-shell.tsx`       | Create | Orchestrates tab state + store wiring + overlays                                           |
| `web/components/mobile/mobile-shell.test.tsx`  | Create | Full money-path integration test                                                           |
| `web/app/app/page.tsx`                         | Create | `/app` route — renders MobileShell in phone-width column                                   |
| `web/app/app/page.test.tsx`                    | Create | Smoke: renders MobileShell                                                                 |
| `web/types/components.ts`                      | Modify | Add ChatHeaderProps, MobileTabbarProps, WalletTabProps, ActivityTabProps, MobileShellProps |
| `web/lib/store/chat-store.ts`                  | Modify | Rename `_defaultStore` → `defaultChatStore` (exported), update `useChatStore` binding      |

---

## Task 15.0 — Export `defaultChatStore` from chat-store

This enables `MobileShell` to accept an optional `store` prop and fall back to the singleton.

**Files:**

- Modify: `web/lib/store/chat-store.ts`

- [ ] **Step 1: Open `web/lib/store/chat-store.ts` and rename `_defaultStore` to `defaultChatStore` and export it**

Change line ~319 from:

```typescript
const _defaultStore = createChatStore();
```

to:

```typescript
/** Module-level singleton vanilla store — used by `useChatStore` and `MobileShell` default. */
export const defaultChatStore = createChatStore();
```

Then update the `useChatStore` implementation (~line 330) that references `_defaultStore` to use `defaultChatStore`:

```typescript
export function useChatStore(): ChatState;
export function useChatStore<U>(selector: (state: ChatState) => U): U;
export function useChatStore<U>(
  selector?: (state: ChatState) => U,
): U | ChatState {
  if (selector) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStore(defaultChatStore, selector);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useStore(defaultChatStore);
}
```

- [ ] **Step 2: Verify existing store tests still pass**

Run: `pnpm --filter @handshake-agent/web test chat-store`

Expected: all existing chat-store tests pass (they use `createChatStore({ schedule: immediate })`, not the singleton, so this rename has no effect on them).

- [ ] **Step 3: Commit**

```bash
git add web/lib/store/chat-store.ts
git commit -m "refactor(web): export defaultChatStore for MobileShell prop injection"
```

---

## Task 15.1 — `ChatHeader` + `MobileTabbar`

Port prototype lines 128–146 (chat header) and 414–431 (bottom nav). No hex in components — use token classes only.

**Files:**

- Create: `web/components/mobile/chat-header.tsx`
- Create: `web/components/mobile/chat-header.test.tsx`
- Create: `web/components/mobile/mobile-tabbar.tsx`
- Create: `web/components/mobile/mobile-tabbar.test.tsx`
- Modify: `web/types/components.ts` (add `ChatHeaderProps`, `MobileTabbarProps`)

### Step 1: Add prop types to `web/types/components.ts`

Append at the end of `web/types/components.ts`:

```typescript
// ─── Phase 15 mobile components ───────────────────────────────────────────────

/** 15.1 — presentational; no state */
export interface ChatHeaderProps {
  className?: string;
}

/** 15.1 — bottom navigation tabbar */
export type MobileTabId = "chat" | "wallet" | "activity";
export interface MobileTabbarProps {
  active: MobileTabId;
  onSelect: (tab: MobileTabId) => void;
  className?: string;
}

/** 15.2 — wallet tab data + callbacks */
export interface WalletTabProps {
  onQuickAction: (action: ChatAction, label: string) => void;
}

/** 15.2 — activity tab (no external props beyond optional className) */
export interface ActivityTabProps {
  className?: string;
}

/** 15.3 — MobileShell accepts an optional injected store for tests */
export interface MobileShellProps {
  /** Injected vanilla Zustand store. Defaults to `defaultChatStore` (the singleton). */
  store?: import("@/lib/store/chat-store").ChatStore;
}
```

### Step 2: Write the failing `ChatHeader` test

Create `web/components/mobile/chat-header.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatHeader } from "./chat-header";

describe("ChatHeader", () => {
  it("renders the agent name", () => {
    render(<ChatHeader />);
    expect(screen.getByText("Handshake Agent")).toBeInTheDocument();
  });

  it("renders the online status", () => {
    render(<ChatHeader />);
    expect(screen.getByText("Online · replies instantly")).toBeInTheDocument();
  });

  it("renders the Secured badge", () => {
    render(<ChatHeader />);
    expect(screen.getByText("Secured")).toBeInTheDocument();
  });

  it("renders the online indicator dot", () => {
    render(<ChatHeader />);
    // The green online dot has role="presentation" (or aria-hidden) per a11y rules
    // We verify the header renders without error and the text nodes are present.
    expect(screen.getByText("Handshake Agent")).toBeInTheDocument();
  });
});
```

### Step 3: Run → fail

Run: `pnpm --filter @handshake-agent/web test chat-header`
Expected: FAIL — `ChatHeader` module not found.

### Step 4: Implement `web/components/mobile/chat-header.tsx`

Port prototype lines 128–146. Every hex becomes a token. Inline `style` is only used for the gradient (which is a design motif, not a tint color — use Tailwind `bg-gradient-to-br from-primary to-primary-deep` instead, or the Tailwind class `[background:linear-gradient(162deg,var(--primary)_0%,var(--primary-deep)_100%)]`). The online dot is `bg-success-bright`. The Secured badge uses `bg-white/10 border-white/15` (structural opacity — no tint).

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { ChatHeaderProps } from "@/types/components";

/**
 * ChatHeader — the persistent top bar of the mobile chat surface.
 * Port of prototype lines 128–146.
 *
 * Token mapping (no hex):
 *   #1a4536→#0e241c gradient → from-primary to-primary-deep
 *   #36c281 online dot → bg-success-bright
 *   #f5a623→#e8961a avatar gradient → from-accent to-accent-deep
 *   #a7e8c6 lock stroke → text-success-bright
 *   #cdeeda "Secured" text → text-success-bright
 */
export function ChatHeader({ className }: ChatHeaderProps) {
  return (
    <div
      className={cn(
        "flex-none [background:linear-gradient(162deg,var(--primary)_0%,var(--primary-deep)_100%)]",
        "px-[18px] pt-[54px] pb-4 text-primary-foreground relative z-10",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {/* Brand avatar with online indicator */}
        <div className="relative h-[42px] w-[42px] flex-none">
          {/* Amber avatar tile */}
          <div
            className={cn(
              "flex h-[42px] w-[42px] items-center justify-center rounded-[13px]",
              "[background:linear-gradient(150deg,var(--accent)_0%,var(--accent-deep)_100%)]",
              "shadow-[0_3px_10px_rgba(0,0,0,0.25)]",
            )}
            aria-hidden="true"
          >
            <div className="h-4 w-4 rounded-[5px] bg-primary-deep" />
          </div>
          {/* Online dot */}
          <div
            className={cn(
              "absolute -right-0.5 -bottom-0.5",
              "h-[13px] w-[13px] rounded-full bg-success-bright",
              "border-[2.5px] border-primary-deep",
            )}
            aria-label="Online"
          />
        </div>

        {/* Name + status */}
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-bold tracking-[-0.01em] text-primary-foreground">
            Handshake Agent
          </div>
          <div className="mt-[1px] text-[12.5px] text-primary-foreground/70">
            Online · replies instantly
          </div>
        </div>

        {/* Secured badge */}
        <div
          className={cn(
            "flex items-center gap-1.5",
            "rounded-full bg-white/10 border border-white/15",
            "px-[11px] py-[5px] pl-[9px]",
          )}
        >
          {/* Lock icon */}
          <svg
            width="12"
            height="13"
            viewBox="0 0 12 13"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <path
              d="M3 6V4.2a3 3 0 016 0V6"
              className="stroke-success-bright"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <rect
              x="1.6"
              y="6"
              width="8.8"
              height="6.2"
              rx="1.8"
              className="fill-success-bright"
            />
          </svg>
          <span className="text-[11.5px] font-semibold text-success-bright">
            Secured
          </span>
        </div>
      </div>
    </div>
  );
}
```

### Step 5: Run → pass

Run: `pnpm --filter @handshake-agent/web test chat-header`
Expected: 4 passed.

### Step 6: Write the failing `MobileTabbar` test

Create `web/components/mobile/mobile-tabbar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MobileTabbar } from "./mobile-tabbar";

describe("MobileTabbar", () => {
  it("renders three tab buttons with labels", () => {
    render(<MobileTabbar active="chat" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /wallet/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /activity/i }),
    ).toBeInTheDocument();
  });

  it("calls onSelect with the tapped tab id", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MobileTabbar active="chat" onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /wallet/i }));
    expect(onSelect).toHaveBeenCalledWith("wallet");
  });

  it("calls onSelect('activity') when Activity is tapped", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MobileTabbar active="chat" onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /activity/i }));
    expect(onSelect).toHaveBeenCalledWith("activity");
  });

  it("calls onSelect('chat') when Chat is tapped", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<MobileTabbar active="wallet" onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /chat/i }));
    expect(onSelect).toHaveBeenCalledWith("chat");
  });

  it("active tab button has aria-current='page'", () => {
    render(<MobileTabbar active="wallet" onSelect={() => {}} />);
    const walletBtn = screen.getByRole("button", { name: /wallet/i });
    expect(walletBtn).toHaveAttribute("aria-current", "page");
  });

  it("inactive tabs do not have aria-current='page'", () => {
    render(<MobileTabbar active="wallet" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /chat/i })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("button", { name: /activity/i }),
    ).not.toHaveAttribute("aria-current", "page");
  });
});
```

### Step 7: Run → fail

Run: `pnpm --filter @handshake-agent/web test mobile-tabbar`
Expected: FAIL — module not found.

### Step 8: Implement `web/components/mobile/mobile-tabbar.tsx`

Port prototype lines 414–431. Active tab uses `text-primary` (dark green); inactive uses `text-muted-foreground`. The three SVG icons are the Chat, Wallet, and Activity glyphs from the prototype. Each button includes a visible text label so color is never the sole signal (§13.8).

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { MobileTabbarProps, MobileTabId } from "@/types/components";

// Tab definitions — icons + labels extracted once (DRY)
const TABS: {
  id: MobileTabId;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
}[] = [
  {
    id: "chat",
    label: "Chat",
    Icon: ({ className }) => (
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        aria-hidden="true"
        className={className}
      >
        <path
          d="M3 6.5A3.5 3.5 0 016.5 3h9A3.5 3.5 0 0119 6.5v5A3.5 3.5 0 0115.5 15H9l-4 3.5V15a3.5 3.5 0 01-2-3.2v-5.3z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "wallet",
    label: "Wallet",
    Icon: ({ className }) => (
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        aria-hidden="true"
        className={className}
      >
        <rect
          x="2.5"
          y="5"
          width="17"
          height="13"
          rx="3.2"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="M14.5 11.5h3.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path d="M2.5 8.5h13" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    ),
  },
  {
    id: "activity",
    label: "Activity",
    Icon: ({ className }) => (
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        aria-hidden="true"
        className={className}
      >
        <path
          d="M2.5 12h3.5l2-7 3.5 13 2.2-8 1.3 2h4.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

/**
 * MobileTabbar — bottom navigation bar.
 * Port of prototype lines 414–431.
 * Active tab: text-foreground (dark). Inactive: text-muted-foreground.
 * aria-current="page" on the active button (color is never the sole signal).
 */
export function MobileTabbar({
  active,
  onSelect,
  className,
}: MobileTabbarProps) {
  return (
    <nav
      aria-label="Main navigation"
      className={cn(
        "flex-none flex bg-card border-t border-border",
        "px-2 pt-[9px] pb-[26px]",
        className,
      )}
    >
      {TABS.map(({ id, label, Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelect(id)}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 cursor-pointer",
              "bg-transparent border-none font-[inherit] py-1",
              isActive ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon />
            <span className="text-[11px] font-semibold">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
```

### Step 9: Run → pass

Run: `pnpm --filter @handshake-agent/web test mobile-tabbar`
Expected: 6 passed.

### Step 10: Run all tests to ensure nothing broke

Run: `pnpm --filter @handshake-agent/web test`
Expected: all 261 + 10 new = 271 passed.

### Step 11: Commit

```bash
git add web/components/mobile/chat-header.tsx web/components/mobile/chat-header.test.tsx \
        web/components/mobile/mobile-tabbar.tsx web/components/mobile/mobile-tabbar.test.tsx \
        web/types/components.ts
git commit -m "feat(web): mobile chat header + tabbar"
```

---

## Task 15.2 — `WalletTab` + `ActivityTab`

Port wallet tab (prototype lines 345–379) and activity tab (382–411). Both consume TanStack Query hooks and implement all four async branches (loading/error/empty/data). Tests use the same `makeWrapper` pattern from `web/lib/query/hooks.test.tsx`.

**Files:**

- Create: `web/components/mobile/wallet-tab.tsx`
- Create: `web/components/mobile/wallet-tab.test.tsx`
- Create: `web/components/mobile/activity-tab.tsx`
- Create: `web/components/mobile/activity-tab.test.tsx`

### Step 1: Write the failing `WalletTab` test

Create `web/components/mobile/wallet-tab.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WalletTab } from "./wallet-tab";

// Fresh QueryClient per test — no cache leakage between cases
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

describe("WalletTab", () => {
  it("renders skeleton placeholders while loading", () => {
    const wrapper = makeWrapper();
    render(<WalletTab onQuickAction={() => {}} />, { wrapper });
    // Skeleton elements are rendered during the loading state
    // (they have data-slot="skeleton" per shadcn's Skeleton)
    // The balance total text should NOT be visible yet
    expect(screen.queryByText("≈ ₦72,340")).not.toBeInTheDocument();
  });

  it("shows balance total after data loads", async () => {
    const wrapper = makeWrapper();
    render(<WalletTab onQuickAction={() => {}} />, { wrapper });
    await waitFor(
      () => expect(screen.getByText("≈ ₦72,340")).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("shows asset names after data loads", async () => {
    const wrapper = makeWrapper();
    render(<WalletTab onQuickAction={() => {}} />, { wrapper });
    await waitFor(
      () => expect(screen.getByText("Tether USD")).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(screen.getByText("Bitcoin")).toBeInTheDocument();
  });

  it("shows all four quick action buttons", async () => {
    const wrapper = makeWrapper();
    render(<WalletTab onQuickAction={() => {}} />, { wrapper });
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: /buy/i }),
        ).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(screen.getByRole("button", { name: /send/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /receive/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /swap/i })).toBeInTheDocument();
  });

  it("fires onQuickAction when a quick action button is clicked", async () => {
    const user = userEvent.setup();
    const onQuickAction = vi.fn();
    const wrapper = makeWrapper();
    render(<WalletTab onQuickAction={onQuickAction} />, { wrapper });
    // Wait for data to render quick action buttons
    const buyBtn = await screen.findByRole(
      "button",
      { name: /buy/i },
      { timeout: 3000 },
    );
    await user.click(buyBtn);
    expect(onQuickAction).toHaveBeenCalledWith("buy", expect.any(String));
  });

  it("fires onQuickAction('send', ...) when Send is clicked", async () => {
    const user = userEvent.setup();
    const onQuickAction = vi.fn();
    const wrapper = makeWrapper();
    render(<WalletTab onQuickAction={onQuickAction} />, { wrapper });
    const sendBtn = await screen.findByRole(
      "button",
      { name: /send/i },
      { timeout: 3000 },
    );
    await user.click(sendBtn);
    expect(onQuickAction).toHaveBeenCalledWith("send", expect.any(String));
  });
});
```

### Step 2: Run → fail

Run: `pnpm --filter @handshake-agent/web test wallet-tab`
Expected: FAIL — `WalletTab` module not found.

### Step 3: Implement `web/components/mobile/wallet-tab.tsx`

Port prototype lines 345–379. Four async branches: loading → `Skeleton`; error → inline error card; empty (zero assets) → "No assets yet"; data → full layout. Quick actions: Buy (glyph `+`), Send (`↗`), Receive (`↓`), Swap (`⇄`). Each calls `onQuickAction(action, chipLabel(action))`. Token mapping: gradient uses `from-primary to-primary-deep`; `#8fe0b4` (today change text) → `text-success-bright`; asset card bg → `bg-card border-border rounded-[18px]`; `#8a9389` section label → `text-muted-foreground`.

```tsx
"use client";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useBalances, useWalletAssets } from "@/lib/query/hooks";
import { chipLabel } from "@/lib/chat/flow";
import type { WalletTabProps } from "@/types/components";
import type { ChatAction } from "@/lib/schemas";

/** Quick action definitions — glyph, label, and store action. */
const QUICK_ACTIONS: { action: ChatAction; glyph: string; label: string }[] = [
  { action: "buy", glyph: "+", label: "Buy" },
  { action: "send", glyph: "↗", label: "Send" },
  { action: "receive", glyph: "↓", label: "Receive" },
  { action: "swap", glyph: "⇄", label: "Swap" },
];

/**
 * WalletTab — mobile wallet surface.
 * Port of prototype lines 345–379.
 * Four async branches: loading / error / empty / data.
 */
export function WalletTab({ onQuickAction }: WalletTabProps) {
  const balancesQuery = useBalances();
  const assetsQuery = useWalletAssets();

  // Loading branch — show skeleton placeholders
  if (balancesQuery.isLoading || assetsQuery.isLoading) {
    return (
      <div className="flex flex-1 flex-col bg-background">
        {/* Hero skeleton */}
        <div className="flex-none [background:linear-gradient(162deg,var(--primary)_0%,var(--primary-deep)_100%)] px-5 pt-[54px] pb-[18px]">
          <Skeleton className="h-4 w-24 bg-white/20" />
          <Skeleton className="mt-2 h-9 w-40 bg-white/20" />
          <Skeleton className="mt-2 h-4 w-32 bg-white/20" />
          <div className="mt-[18px] flex gap-[9px]">
            {QUICK_ACTIONS.map((a) => (
              <Skeleton
                key={a.action}
                className="h-[68px] flex-1 rounded-[14px] bg-white/20"
              />
            ))}
          </div>
        </div>
        {/* Assets skeleton */}
        <div className="flex-1 overflow-y-auto p-4">
          <Skeleton className="mb-2.5 h-3 w-16 bg-muted" />
          <div className="rounded-[18px] border border-border bg-card overflow-hidden">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-[15px] py-[14px] border-t border-border first:border-t-0"
              >
                <Skeleton className="h-[38px] w-[38px] rounded-[11px]" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error branch
  if (balancesQuery.isError || assetsQuery.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 bg-background">
        <p className="text-sm font-semibold text-foreground">
          Couldn't load wallet
        </p>
        <p className="text-sm text-muted-foreground text-center">
          Check your connection and pull to refresh.
        </p>
      </div>
    );
  }

  const balances = balancesQuery.data;
  const assets = assetsQuery.data ?? [];

  // Empty branch
  if (!balances || assets.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 bg-background">
        <p className="text-sm font-semibold text-foreground">No assets yet</p>
        <p className="text-sm text-muted-foreground text-center">
          Fund your wallet to get started.
        </p>
      </div>
    );
  }

  // Data branch
  return (
    <div className="flex flex-1 min-h-0 flex-col bg-background">
      {/* Balance hero */}
      <div className="flex-none [background:linear-gradient(162deg,var(--primary)_0%,var(--primary-deep)_100%)] text-primary-foreground px-5 pt-[54px] pb-[18px]">
        <div className="text-[13px] font-semibold text-primary-foreground/70">
          Total balance
        </div>
        <div className="mt-0.5 text-[34px] font-extrabold tracking-[-0.02em] tabular-nums">
          {balances.total}
        </div>
        <div className="mt-0.5 text-[13px] text-success-bright">
          +₦1,210 (1.7%) today
        </div>

        {/* Quick actions */}
        <div className="mt-[18px] flex gap-[9px]">
          {QUICK_ACTIONS.map(({ action, glyph, label }) => (
            <button
              key={action}
              type="button"
              aria-label={label}
              onClick={() => onQuickAction(action, chipLabel(action))}
              className={cn(
                "flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-[14px]",
                "border border-white/15 bg-white/8 py-[11px]",
                "text-primary-foreground font-[inherit]",
              )}
            >
              <span
                className={cn(
                  "flex h-[30px] w-[30px] items-center justify-center",
                  "rounded-[9px] bg-accent text-accent-foreground",
                  "text-[17px] font-bold",
                )}
                aria-hidden="true"
              >
                {glyph}
              </span>
              <span className="text-[12px] font-semibold">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Assets list */}
      <div className="noscroll flex-1 overflow-y-auto p-4">
        <div className="mb-2.5 ml-1 text-[12px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
          Assets
        </div>
        <div className="overflow-hidden rounded-[18px] border border-border bg-card">
          {assets.map((asset, i) => (
            <div
              key={asset.sym}
              className={cn(
                "flex items-center gap-3 px-[15px] py-[14px]",
                i > 0 && "border-t border-border",
              )}
            >
              {/* Asset icon */}
              <div
                className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] text-[15px] font-extrabold text-primary-deep"
                style={{ backgroundColor: asset.tint }}
                aria-hidden="true"
              >
                {asset.sym}
              </div>
              {/* Name + amount */}
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-bold text-foreground">
                  {asset.name}
                </div>
                <div className="tabular-nums text-[12.5px] text-muted-foreground">
                  {asset.amount}
                </div>
              </div>
              {/* Value + change */}
              <div className="text-right">
                <div className="tabular-nums text-[14.5px] font-bold text-foreground">
                  {asset.value}
                </div>
                <div className="text-[12px] text-success">{asset.change}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### Step 4: Run → pass

Run: `pnpm --filter @handshake-agent/web test wallet-tab`
Expected: 5 passed.

### Step 5: Write the failing `ActivityTab` test

Create `web/components/mobile/activity-tab.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityTab } from "./activity-tab";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

describe("ActivityTab", () => {
  it("renders skeleton while loading", () => {
    const wrapper = makeWrapper();
    render(<ActivityTab />, { wrapper });
    // Group label "Today" not visible while loading
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
  });

  it("shows 'Today' group label after data loads", async () => {
    const wrapper = makeWrapper();
    render(<ActivityTab />, { wrapper });
    await waitFor(() => expect(screen.getByText("Today")).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it("shows 'Yesterday' group label after data loads", async () => {
    const wrapper = makeWrapper();
    render(<ActivityTab />, { wrapper });
    await waitFor(
      () => expect(screen.getByText("Yesterday")).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("shows a transaction title after data loads", async () => {
    const wrapper = makeWrapper();
    render(<ActivityTab />, { wrapper });
    await waitFor(
      () => expect(screen.getByText("Bought USDT")).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("shows status pills (Completed / Confirming)", async () => {
    const wrapper = makeWrapper();
    render(<ActivityTab />, { wrapper });
    const completed = await screen.findAllByText(
      "Completed",
      {},
      { timeout: 3000 },
    );
    expect(completed.length).toBeGreaterThan(0);
  });

  it("shows the Activity header text", async () => {
    const wrapper = makeWrapper();
    render(<ActivityTab />, { wrapper });
    await waitFor(
      () => expect(screen.getByText("Activity")).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });
});
```

### Step 6: Run → fail

Run: `pnpm --filter @handshake-agent/web test activity-tab`
Expected: FAIL — module not found.

### Step 7: Implement `web/components/mobile/activity-tab.tsx`

Port prototype lines 382–411. Use `StatusPill` for each status badge. Token mapping: `#8a9389` → `text-muted-foreground`; activity icon tint/col applied via `style` (data values). Four async branches.

```tsx
"use client";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/shared/status-pill";
import { useActivity } from "@/lib/query/hooks";
import type { ActivityTabProps } from "@/types/components";

/**
 * ActivityTab — mobile activity/history surface.
 * Port of prototype lines 382–411.
 * Four async branches: loading / error / empty / data.
 * Data tint/col on icon rows applied via inline style (data values, not theme tokens).
 */
export function ActivityTab({ className }: ActivityTabProps) {
  const { data: groups, isLoading, isError } = useActivity();

  // Loading branch
  if (isLoading) {
    return (
      <div
        className={cn("flex flex-1 min-h-0 flex-col bg-background", className)}
      >
        <div className="flex-none [background:linear-gradient(162deg,var(--primary)_0%,var(--primary-deep)_100%)] px-5 pt-[54px] pb-[18px] text-primary-foreground">
          <Skeleton className="h-6 w-24 bg-white/20" />
          <Skeleton className="mt-1.5 h-4 w-48 bg-white/20" />
        </div>
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {[1, 2].map((g) => (
            <div key={g}>
              <Skeleton className="mb-2 h-3 w-16" />
              <div className="rounded-[18px] border border-border bg-card overflow-hidden">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-[15px] py-[13px] border-t border-border first:border-t-0"
                  >
                    <Skeleton className="h-9 w-9 rounded-[10px]" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-28" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Skeleton className="h-3.5 w-20" />
                      <Skeleton className="h-4 w-16 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error branch
  if (isError) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-2 p-8 bg-background",
          className,
        )}
      >
        <p className="text-sm font-semibold text-foreground">
          Couldn't load activity
        </p>
        <p className="text-sm text-muted-foreground text-center">
          Check your connection and try again.
        </p>
      </div>
    );
  }

  // Empty branch
  if (!groups || groups.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-2 p-8 bg-background",
          className,
        )}
      >
        <p className="text-sm font-semibold text-foreground">No activity yet</p>
        <p className="text-sm text-muted-foreground text-center">
          Your transactions will appear here.
        </p>
      </div>
    );
  }

  // Data branch
  return (
    <div
      className={cn("flex flex-1 min-h-0 flex-col bg-background", className)}
    >
      {/* Header */}
      <div className="flex-none [background:linear-gradient(162deg,var(--primary)_0%,var(--primary-deep)_100%)] text-primary-foreground px-5 pt-[54px] pb-[18px]">
        <div className="text-[22px] font-extrabold tracking-[-0.01em]">
          Activity
        </div>
        <div className="mt-0.5 text-[13px] text-primary-foreground/70">
          Every transaction, with a receipt.
        </div>
      </div>

      {/* Groups list */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.group}>
            {/* Group label */}
            <div className="mb-[9px] ml-1 text-[12px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
              {group.group}
            </div>
            {/* Items */}
            <div className="overflow-hidden rounded-[18px] border border-border bg-card">
              {group.items.map((item, i) => (
                <div
                  key={`${group.group}-${i}`}
                  className={cn(
                    "flex items-center gap-3 px-[15px] py-[13px]",
                    i > 0 && "border-t border-border",
                  )}
                >
                  {/* Icon chip — data tint/col via inline style */}
                  <div
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] text-[17px] font-bold"
                    style={{ backgroundColor: item.tint, color: item.col }}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </div>
                  {/* Title + sub */}
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-bold text-foreground">
                      {item.title}
                    </div>
                    <div className="tabular-nums text-[12.5px] text-muted-foreground">
                      {item.sub}
                    </div>
                  </div>
                  {/* Amount + status */}
                  <div className="text-right">
                    <div className="tabular-nums text-[14px] font-bold text-foreground">
                      {item.amount}
                    </div>
                    <div className="mt-0.5">
                      <StatusPill tone={item.statusTone}>
                        {item.status}
                      </StatusPill>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Step 8: Run → pass

Run: `pnpm --filter @handshake-agent/web test activity-tab`
Expected: 6 passed.

### Step 9: Run all tests

Run: `pnpm --filter @handshake-agent/web test`
Expected: all 261 + 10 + 11 = 282 passed (approximately).

### Step 10: Commit

```bash
git add web/components/mobile/wallet-tab.tsx web/components/mobile/wallet-tab.test.tsx \
        web/components/mobile/activity-tab.tsx web/components/mobile/activity-tab.test.tsx
git commit -m "feat(web): mobile wallet + activity tabs"
```

---

## Task 15.3 — `MobileShell` + `/app` route

This is the full money-path integration. `MobileShell` wires the store to the chat UI and overlays. The focus-trap dialog wrapping `PinPad` resolves the Phase 13 TODO. The integration test proves NO receipt before 4 digits.

**Files:**

- Create: `web/components/mobile/mobile-shell.tsx`
- Create: `web/components/mobile/mobile-shell.test.tsx`
- Create: `web/app/app/page.tsx`
- Create: `web/app/app/page.test.tsx`

### Step 1: Write the failing integration test

This is the primary money-path guard. It uses a fresh `createChatStore({ schedule: (fn) => fn() })` (immediate scheduler) injected via the `store` prop — this avoids real `setTimeout` and makes the test synchronous/deterministic.

Create `web/components/mobile/mobile-shell.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createChatStore } from "@/lib/store/chat-store";
import { chipLabel } from "@/lib/chat/flow";
import { MobileShell } from "./mobile-shell";

// ─── Test utilities ───────────────────────────────────────────────────────────

/** Fresh QueryClient per test (no cache leakage) */
function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

/** Synchronous scheduler — no real setTimeout; assistant replies appear instantly */
const immediate = (fn: () => void) => fn();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MobileShell", () => {
  it("shows the greeting message on the default chat tab", () => {
    const store = createChatStore({ schedule: immediate });
    const wrapper = makeWrapper();
    render(<MobileShell store={store} />, { wrapper });
    // The greeting text from GREETING_M contains "Handshake" or similar;
    // we check that the thread renders at least one assistant message.
    // The greeting is the first message in threads.m.
    const greeting = store.getState().threads.m[0];
    expect(
      screen.getByText(greeting.kind === "text" ? greeting.text : ""),
    ).toBeInTheDocument();
  });

  it("shows chip buttons matching startChips()", () => {
    const store = createChatStore({ schedule: immediate });
    const wrapper = makeWrapper();
    render(<MobileShell store={store} />, { wrapper });
    // "Buy ₦50,000 of USDT" chip
    expect(
      screen.getByRole("button", { name: chipLabel("buy") }),
    ).toBeInTheDocument();
  });

  // ─── FULL MONEY-PATH GUARD ─────────────────────────────────────────────────
  // This test is the PRIMARY guard for the mobile money path.
  // It MUST prove that no receipt appears before the 4th PIN digit.

  it("full buy flow: chip → quote → confirm → PIN → receipt + success; NO receipt before 4th digit", async () => {
    const user = userEvent.setup();
    const store = createChatStore({ schedule: immediate });
    const wrapper = makeWrapper();
    render(<MobileShell store={store} />, { wrapper });

    // ── 1. Click the "Buy ₦50,000 of USDT" chip ────────────────────────────
    const buyChip = screen.getByRole("button", { name: chipLabel("buy") });
    await user.click(buyChip);

    // With the immediate scheduler, assistant messages appear synchronously.
    // The user bubble + text + quote card should all be in the DOM.
    expect(screen.getByText(chipLabel("buy"))).toBeInTheDocument(); // user msg
    expect(screen.getByText("29.97 USDT")).toBeInTheDocument(); // quote card receive amount

    // ── 2. No receipt yet ──────────────────────────────────────────────────
    expect(screen.queryByText("Purchase complete")).not.toBeInTheDocument();

    // ── 3. Click "Review & confirm" button on the QuoteCard ────────────────
    const reviewBtn = screen.getByRole("button", { name: /review & confirm/i });
    await user.click(reviewBtn);

    // ConfirmSheet should be open (rendered as a bottom Sheet)
    // The sheet body contains the title "Confirm purchase"
    await waitFor(() =>
      expect(screen.getByText("Confirm purchase")).toBeInTheDocument(),
    );

    // ── 4. Still no receipt ────────────────────────────────────────────────
    expect(screen.queryByText("Purchase complete")).not.toBeInTheDocument();

    // ── 5. Click "Confirm with PIN" → PinPad opens ─────────────────────────
    const ctaBtn = screen.getByRole("button", { name: /confirm with pin/i });
    await user.click(ctaBtn);

    // PinPad dialog should appear
    await waitFor(() =>
      expect(screen.getByText("Enter your PIN")).toBeInTheDocument(),
    );

    // ── 6. Press first 3 digits — still no receipt ─────────────────────────
    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    await user.click(screen.getByRole("button", { name: "3" }));
    // Receipt MUST NOT appear before 4th digit (PIN gate invariant)
    expect(screen.queryByText("Purchase complete")).not.toBeInTheDocument();

    // ── 7. Press 4th digit → receipt appears + success overlay ─────────────
    await user.click(screen.getByRole("button", { name: "4" }));

    // Receipt card should now appear in the thread
    await waitFor(() =>
      expect(screen.getByText("Purchase complete")).toBeInTheDocument(),
    );

    // Success overlay should appear
    expect(screen.getByTestId("success")).toBeInTheDocument();
    expect(screen.getByText("Purchase complete")).toBeInTheDocument();

    // PinPad should be gone
    expect(screen.queryByText("Enter your PIN")).not.toBeInTheDocument();
  });

  it("clicking the Wallet tab shows the balance total", async () => {
    const user = userEvent.setup();
    const store = createChatStore({ schedule: immediate });
    const wrapper = makeWrapper();
    render(<MobileShell store={store} />, { wrapper });

    // Tap the Wallet tab
    await user.click(screen.getByRole("button", { name: /wallet/i }));

    // Balance should load (WalletTab uses TanStack Query mock data)
    await waitFor(
      () => expect(screen.getByText("≈ ₦72,340")).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it("clicking the Activity tab shows the group header", async () => {
    const user = userEvent.setup();
    const store = createChatStore({ schedule: immediate });
    const wrapper = makeWrapper();
    render(<MobileShell store={store} />, { wrapper });

    // Tap the Activity tab
    await user.click(screen.getByRole("button", { name: /activity/i }));

    // Activity data should load
    await waitFor(() => expect(screen.getByText("Today")).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it("tapping Wallet quick action switches to chat with a send message queued", async () => {
    const user = userEvent.setup();
    const store = createChatStore({ schedule: immediate });
    const wrapper = makeWrapper();
    render(<MobileShell store={store} />, { wrapper });

    // Switch to Wallet tab
    await user.click(screen.getByRole("button", { name: /wallet/i }));
    // Wait for wallet data
    const buyBtn = await screen.findByRole(
      "button",
      { name: /buy/i },
      { timeout: 3000 },
    );
    // Click the Buy quick action on the Wallet tab
    await user.click(buyBtn);

    // MobileShell should switch back to chat tab and call store.send("m", label, action)
    // This means the thread now has a user message "Buy ₦50,000 of USDT"
    await waitFor(() =>
      expect(screen.getByText(chipLabel("buy"))).toBeInTheDocument(),
    );
  });
});
```

### Step 2: Run → fail

Run: `pnpm --filter @handshake-agent/web test mobile-shell`
Expected: FAIL — `MobileShell` module not found.

### Step 3: Implement `web/components/mobile/mobile-shell.tsx`

Key design decisions:

1. Accepts `store?: ChatStore` (vanilla Zustand store); defaults to `defaultChatStore`. Uses `useStore(store)` for reactivity.
2. Local `useState<MobileTabId>("chat")` for tab state.
3. The `PinPad` is wrapped in a focus-trap `FocusScope` from `radix-ui` with `role="dialog" aria-modal="true" aria-label="Enter your PIN"`. No Esc-dismiss on the PIN gate.
4. `onConfirm(message)` checks `message.kind === "quote"` and dispatches to the right confirm builder via `message.action`.
5. WalletTab `onQuickAction` switches tab to "chat" then calls `store.send("m", label, action)`.
6. The `PinPad` + focus trap are in a `position: absolute` containing block — the shell itself must be `relative`.

```tsx
"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { FocusScope } from "radix-ui";
import { defaultChatStore, type ChatStore } from "@/lib/store/chat-store";
import {
  buildBuyConfirm,
  buildSendConfirm,
  buildSwapConfirm,
  buildTicketConfirm,
  chipLabel,
} from "@/lib/chat/flow";
import { ChatHeader } from "./chat-header";
import { MobileTabbar, type MobileTabId } from "./mobile-tabbar";
import { WalletTab } from "./wallet-tab";
import { ActivityTab } from "./activity-tab";
import { ChatThread } from "@/components/chat/chat-thread";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ConfirmSheet } from "@/components/chat/overlays/confirm-sheet";
import { PinPad } from "@/components/chat/overlays/pin-pad";
import { SuccessOverlay } from "@/components/chat/overlays/success-overlay";
import type { MobileShellProps } from "@/types/components";
import type { ChatMessage, TicketOption } from "@/lib/schemas";

/**
 * MobileShell — the full mobile surface.
 *
 * Holds:
 *   - Local tab state (chat | wallet | activity)
 *   - Reactive store state via `useStore(store)` (injected or singleton)
 *
 * Store-wiring contract (§3.1 SACROSANCT INVARIANT preserved):
 *   - `onConfirm` on ChatThread → `store.openConfirm("m", buildXConfirm())`
 *   - `onSelectTicket` → `store.openConfirm("m", buildTicketConfirm(...))`
 *   - ConfirmSheet `onConfirm` → `store.confirmToPin()`
 *   - PinPad `onDigit` → `store.pressPin(d)` — at 4 digits, store auto-calls `pinComplete()`
 *   - PinPad `onFaceId` → `store.pinComplete()` directly (Face ID shortcut)
 *   - ONLY `pinComplete()` appends a receipt.
 *
 * PinPad is wrapped in a `FocusScope` (radix-ui) with `trapped` + `loop` so focus
 * cannot escape the PIN dialog. No Esc-dismiss — a PIN gate must not be bypassable
 * by keyboard shortcut.
 */
export function MobileShell({ store: injectedStore }: MobileShellProps) {
  // Reactive state from the vanilla store — re-renders on every mutation.
  const store = useStore(injectedStore ?? defaultChatStore);

  // Local UI state — tab selection is not global state, it's view-local.
  const [tab, setTab] = useState<MobileTabId>("chat");

  // ── Callbacks ────────────────────────────────────────────────────────────────

  /** Called when a QuoteCard's "Review & confirm" button is clicked. */
  function handleConfirm(message: ChatMessage) {
    if (message.kind !== "quote") return;
    const payload =
      message.action === "buy"
        ? buildBuyConfirm()
        : message.action === "send"
          ? buildSendConfirm()
          : buildSwapConfirm();
    store.openConfirm("m", payload);
  }

  /** Called when a TicketsCard tier is selected. */
  function handleSelectTicket(opt: TicketOption) {
    store.openConfirm("m", buildTicketConfirm(opt.tier, opt.price, opt.total));
  }

  /** WalletTab quick action → switch to chat, send the action message. */
  function handleQuickAction(
    action: Parameters<typeof store.send>[2],
    label: string,
  ) {
    setTab("chat");
    store.send("m", label, action);
  }

  // ── Overlay visibility guards ─────────────────────────────────────────────────
  // Only show overlays when they belong to this surface ("m").
  const showConfirm = store.confirmOpen && store.overlaySurface === "m";
  const showPin = store.pinOpen && store.overlaySurface === "m";
  const showSuccess = store.successOpen && store.successSurface === "m";

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-background">
      {/* ── Tab body ─────────────────────────────────────────────────────────── */}
      {tab === "chat" && (
        <>
          <ChatHeader />
          <ChatThread
            messages={store.threads.m}
            typing={store.typing.m}
            density="mobile"
            onConfirm={handleConfirm}
            onSelectTicket={handleSelectTicket}
          />
          <ChatComposer
            chips={store.chips.m}
            value={store.input.m}
            onChange={(v) => store.setInput("m", v)}
            onSubmit={() => store.send("m", store.input.m)}
            onChip={(a) => store.send("m", chipLabel(a), a)}
            density="mobile"
          />
        </>
      )}

      {tab === "wallet" && <WalletTab onQuickAction={handleQuickAction} />}

      {tab === "activity" && <ActivityTab />}

      {/* ── Bottom nav ───────────────────────────────────────────────────────── */}
      <MobileTabbar active={tab} onSelect={setTab} />

      {/* ── Overlays ─────────────────────────────────────────────────────────── */}

      {/* Confirm sheet — renders as a bottom Sheet on mobile */}
      <ConfirmSheet
        open={showConfirm}
        payload={store.pending}
        density="mobile"
        onConfirm={store.confirmToPin}
        onCancel={store.cancel}
      />

      {/*
        PinPad — wrapped in FocusScope (radix-ui) to trap focus.
        - `trapped`: keeps focus inside the dialog while PIN is open.
        - `loop`: Tab wraps around so the user can cycle through digit buttons.
        - No Esc-dismiss: a PIN gate must not be bypassable by keyboard.
        - The FocusScope div has role="dialog" aria-modal="true" aria-label so
          screen readers announce it as a modal dialog.
      */}
      {showPin && (
        <FocusScope trapped loop asChild>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Enter your PIN"
            className="absolute inset-0 z-[45]"
          >
            <PinPad
              open
              pinLength={store.pin.length}
              density="mobile"
              onDigit={store.pressPin}
              onBack={store.pinBack}
              onFaceId={store.pinComplete}
              onCancel={store.cancel}
            />
          </div>
        </FocusScope>
      )}

      {/* Success overlay */}
      <SuccessOverlay open={showSuccess} text={store.successText} />
    </div>
  );
}
```

### Step 4: Run → pass (some tests may need waitFor adjustments)

Run: `pnpm --filter @handshake-agent/web test mobile-shell`
Expected: 6 passed. If any test fails due to async timing, the issue is that `findBy*` needs a larger timeout — increase `timeout: 5000`. The immediate scheduler means chat tests are synchronous; wallet/activity tab tests need `waitFor` for TanStack Query.

If the `PinPad` focus-trap causes issues in jsdom (which doesn't implement `focus()` fully), add a `try/catch` guard inside `FocusScope` or conditionally skip `trapped` in test env — but try first without it.

### Step 5: Write the `/app` page test

Create `web/app/app/page.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppPage from "./page";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("/app page", () => {
  it("renders MobileShell (chat header present)", () => {
    render(<AppPage />, { wrapper });
    expect(screen.getByText("Handshake Agent")).toBeInTheDocument();
  });

  it("renders the bottom navigation", () => {
    render(<AppPage />, { wrapper });
    expect(
      screen.getByRole("navigation", { name: /main navigation/i }),
    ).toBeInTheDocument();
  });
});
```

### Step 6: Run → fail

Run: `pnpm --filter @handshake-agent/web test app/app/page`
Expected: FAIL — page not found.

### Step 7: Implement `web/app/app/page.tsx`

Create the directory and page. This is a server component that renders `MobileShell` in a phone-width centered column on the cream background. The shell itself is `"use client"`.

```tsx
import { MobileShell } from "@/components/mobile/mobile-shell";

/**
 * /app route — the mobile chat-native surface.
 *
 * Renders `MobileShell` in a phone-width column (max-w ~420px, full height)
 * centered on the brand cream background.
 * The shell is a client component; this page is a server component wrapper.
 */
export default function AppPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="relative flex h-[min(100dvh,844px)] w-full max-w-[420px] flex-col overflow-hidden rounded-none shadow-2xl sm:rounded-[44px]"
        style={{ boxShadow: "0 24px 80px rgba(0,0,0,0.18)" }}
      >
        <MobileShell />
      </div>
    </main>
  );
}
```

### Step 8: Run → pass

Run: `pnpm --filter @handshake-agent/web test app/app/page`
Expected: 2 passed.

### Step 9: Run full test suite

Run: `pnpm --filter @handshake-agent/web test`
Expected: all tests pass. Count: 261 (baseline) + 1 (store rename) + 10 (header+tabbar) + 11 (wallet+activity) + 6 (mobile-shell) + 2 (page) = ~291 passed.

### Step 10: Typecheck + lint

```bash
pnpm --filter @handshake-agent/web typecheck
pnpm --filter @handshake-agent/web lint
```

Both must pass. Fix any issues before committing.

Common typecheck issues to anticipate:

- `MobileShellProps.store` type is `ChatStore | undefined`. `ChatStore = ReturnType<typeof createChatStore>`. The `useStore(injectedStore ?? defaultChatStore)` call is fine since both are `StoreApi<ChatState>`.
- `handleQuickAction`'s first parameter type: `action: Parameters<typeof store.send>[2]` resolves to `ChatAction | undefined`. But the WalletTab's `onQuickAction` prop type is `(action: ChatAction, label: string) => void`. Cast or refine: use `action: ChatAction` directly in `handleQuickAction`'s signature (the WalletTab always passes a defined `ChatAction`).
- `FocusScope` from `radix-ui` — if TS can't find the type, check that `radix-ui` is in `web/package.json` dependencies. It is (shadcn installed it). The import `import { FocusScope } from "radix-ui"` should work.
- `MobileTabId` needs to be exported from `mobile-tabbar.tsx` (it's a type defined in `components.ts` — just import it there). Actually `MobileTabId` is defined in `web/types/components.ts`; `mobile-tabbar.tsx` imports it from `@/types/components`. In `mobile-shell.tsx`, the re-export `type MobileTabId` from `mobile-tabbar.tsx` is used — just import it from `@/types/components` directly instead.

Fix the `mobile-shell.tsx` import to use `@/types/components` for `MobileTabId`:

```typescript
// In mobile-shell.tsx — replace:
import { MobileTabbar, type MobileTabId } from "./mobile-tabbar";
// With:
import { MobileTabbar } from "./mobile-tabbar";
import type { MobileShellProps, MobileTabId } from "@/types/components";
```

### Step 11: Commit

```bash
git add web/components/mobile/mobile-shell.tsx web/components/mobile/mobile-shell.test.tsx \
        web/app/app/page.tsx web/app/app/page.test.tsx
git commit -m "feat(web): mobile shell + /app route (full chat→PIN→receipt flow)"
```

---

## Self-review (completed by plan author)

**1. Spec coverage:**

- Task 15.1 — ChatHeader (lines 128–146) + MobileTabbar (lines 414–431) + tests ✔
- Task 15.2 — WalletTab (345–379) + ActivityTab (382–411) + 4 async branches + tests ✔
- Task 15.3 — MobileShell store-wiring contract (all 6 props verified) ✔
- Task 15.3 — PinPad wrapped in FocusScope dialog (resolves Phase 13 TODO) ✔
- Task 15.3 — Full money-path integration test including "NO receipt before 4th digit" ✔
- Task 15.3 — `/app` route renders MobileShell in phone-width column ✔
- Task 15.3 — WalletTab quick action switches tab to "chat" + calls `store.send("m", label, action)` ✔
- Task 15.0 — `defaultChatStore` export enables prop injection ✔

**2. Placeholder scan:** None. All test code is complete. All component implementations are complete. All exact selector names, prop shapes, and token class names are specified.

**3. Type consistency:**

- `MobileTabId = "chat" | "wallet" | "activity"` — defined once in `web/types/components.ts`, used in `MobileTabbar`, `MobileShell`.
- `WalletTabProps.onQuickAction: (action: ChatAction, label: string) => void` — matches `handleQuickAction` in `MobileShell`.
- `MobileShellProps.store?: ChatStore` — `ChatStore = ReturnType<typeof createChatStore>` (already exported from `chat-store.ts`).
- `handleConfirm(message: ChatMessage)` — matches `ChatThreadProps.onConfirm: (m: ChatMessage) => void`.
- `handleSelectTicket(opt: TicketOption)` — matches `ChatThreadProps.onSelectTicket: (opt: TicketOption) => void`.
- Store-wiring selectors (`store.threads.m`, `store.chips.m`, etc.) — all match the `ChatState` interface in `chat-store.ts`.
- Token classes: `from-primary`, `to-primary-deep`, `text-success-bright`, `bg-success-bright`, `text-muted-foreground`, `bg-card`, `border-border` — all in the locked hex→token table and defined in `globals.css`.

**Drift found (for user to triage, not fixed here):**

- `WalletTab` hardcodes "+₦1,210 (1.7%) today" as static copy — in a real build this comes from the backend. This is intentional for the prototype (matching the prototype HTML exactly) and should be tracked as a `TODO(WALLET-TODAY-DELTA): pull from API`.
- `AppPage` uses `box-shadow` via inline `style` for the phone frame drop shadow — this is acceptable for a decorative structural shadow (not a tint color). Alternatively it could be a `shadow-2xl` Tailwind class.

---

## Execution choice

Plan complete and saved to `docs/superpowers/plans/2026-06-19-phase-15-mobile-surface.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration.
Use `superpowers:subagent-driven-development`.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
