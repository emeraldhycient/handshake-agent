# Wave 0 — Foundation & Overview Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the reusable table + data-table primitives, the per-feature constants/types convention, and the componentisation standards in CLAUDE.md — proven end-to-end by decomposing `web`'s `overview-page.tsx` into an orchestrator plus small section components, with no visible change.

**Architecture:** Add a canonical `Table` primitive to `web` (mirroring `web-admin`'s, but with `web` tokens so the current Assets table stays pixel-identical) and a column-config-driven `shared/DataTable` on top of it. Extract the overview page's Balance hero, Assets table, and Recent-activity list into three section components; the Assets and Recent-activity sections render through `DataTable`. Magic values move to `web/constants/overview.ts`; new prop types to `web/types/overview.ts`. The page keeps only data hooks, the four async branches, and composition. Record the standards in root + `web` + `web-admin` CLAUDE.md.

**Tech Stack:** Next.js 16 (App Router, React 19), Tailwind v4 (CSS-first, oklch tokens, no config file), shadcn (style `radix-vega`), `radix-ui` unified package, Vitest + React Testing Library + `@testing-library/user-event`, TanStack Query, Zustand.

## Global Constraints

- Behavior and pixels are **preserved** — this wave changes structure only (no routing change; routing is Wave 1). — spec §2.7
- Tokens only, **no hex literals**; status semantics fixed (`success`/`warn`/`danger`/`info`/neutral). Icon tint/colour that come from **data** stay inline `style` (they already do). — root §5, §13
- `radix-ui` is the **unified** package (`import { Slot } from "radix-ui"`); never add `@radix-ui/react-*`. There is **no `tailwind.config.js`**. — web/CLAUDE.md
- Size caps: component ≤150 lines, file ≤300, function ≤40; early returns over deep nesting. — root §13.3
- Imports flow strictly down `app → components → lib → types`; `components/` must not import from `app/`. `dependency-cruiser` must stay clean. — root §4.2
- Every async UI keeps its four branches: loading / error / empty / data. — root §5
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit. — root §9
- Commits are Conventional Commits with an allowed scope (`web`, `web-admin`, `repo`, `docs`, …). Use `feat(web):` / `refactor(web):` / `test(web):` / `docs(repo):`. Do **not** use `spec` as a scope.
- Run tests from the repo root scoped to the package: `pnpm --filter @handshake-agent/web test -- <file>` (Vitest). Verify gates independently — do not trust self-reported green. — repo memory

---

## Visual Verification Runbook (used by Task 9 and every future wave)

The Postgres (`handshake-agent-db`, host port **5544**) and Redis (`handshake-agent-redis`, 6379) containers are already running. `api/.env` has real keys and `AUTH_DEV_EXPOSE_OTP=true`. `web/.env.local` points the web app at the API on `http://localhost:3001` with `NEXT_PUBLIC_USE_MOCK=false`.

1. **Start the API on :3001** (background). From repo root:
   `cd api && PORT=3001 pnpm dev` — run via Bash `run_in_background: true` (ts-node, no watch; restart after any api change — not needed this wave). Wait for `Nest application successfully started`.
2. **Start the web dev server** with `preview_start` (config name `web`, port 3000).
3. **Baseline screenshot (capture BEFORE Task 1):** log in (step 4), navigate to the desktop dashboard, `preview_screenshot`. Save it as the visual baseline to diff the post-refactor overview against.
4. **Log in as the Docker test user** `qa.fulltest@example.com` (active, verified, tier_1):
   - `preview_eval: window.location.href = 'http://localhost:3000/login'` (unauth root also redirects to `/login`).
   - `preview_fill` the email field with `qa.fulltest@example.com`; submit.
   - Read the dev-exposed OTP: check the API response via `preview_network` (the request that requests the challenge), and/or the API stdout via the background Bash output (`AUTH_DEV_EXPOSE_OTP=true` surfaces it). Then `preview_fill` the OTP field and submit.
   - Confirm authenticated: `preview_snapshot` shows the dashboard (Total balance hero).
5. **Verify overview (desktop):** at ≥lg viewport (`preview_resize preset desktop`), `preview_snapshot` + `preview_screenshot`; confirm Balance hero, Assets rows (Tether USD), Recent activity rows are present and visually match the baseline.
6. **Check console/network:** `preview_console_logs level:error` and `preview_network filter:failed` — must be clean of new errors.

If the login field selectors differ, discover them with `preview_snapshot` before filling. This runbook is captured in `web/CLAUDE.md` (Task 8) so later waves reuse it.

---

## File Structure

- `web/components/ui/table.tsx` — **new.** Canonical `Table` primitive (Table/Header/Body/Row/Head/Cell/Caption), `web` tokens, defaults matching the current Assets table.
- `web/components/shared/data-table.tsx` — **new.** Generic column-config table over the primitive. Presentational only.
- `web/types/data-table.ts` — **new.** `DataTableColumn<Row>`, `DataTableProps<Row>`.
- `web/types/overview.ts` — **new.** `BalanceHeroProps`, `AssetsTableProps`, `RecentActivityTableProps`.
- `web/types/index.ts` — **new.** Barrel re-exporting `./components`, `./data-table`, `./overview` (enables `@/types`; existing `@/types/components` imports keep working).
- `web/constants/overview.ts` — **new.** `HERO_ACTIONS`, `ASSET_COLUMNS`, `ACTIVITY_COLUMNS` (column configs live with the feature).
- `web/components/desktop/overview/balance-hero.tsx` — **new.** Hero + hero-action buttons.
- `web/components/desktop/overview/assets-table.tsx` — **new.** `DataTable` over wallet assets.
- `web/components/desktop/overview/recent-activity-table.tsx` — **new.** Headerless `DataTable` over the activity feed.
- `web/components/desktop/overview-page.tsx` — **modify.** Slim to orchestrator (hooks + 4 branches + compose sections).
- `web/components/desktop/overview-page.test.tsx` — **modify.** Disambiguate the now-two tables by accessible name.
- `web/CLAUDE.md`, `web-admin/CLAUDE.md`, `CLAUDE.md` — **modify.** New componentisation standards + the visual runbook (web).

New section files live in a `overview/` subfolder beside the page (files that change together live together). This is the pattern; Wave 1 lifts `overview-page.tsx`'s body into `app/(app)/page.tsx` and these sections move with it unchanged.

---

### Task 1: `web` `Table` primitive

**Files:**

- Create: `web/components/ui/table.tsx`
- Test: `web/components/ui/table.test.tsx`

**Interfaces:**

- Produces: `Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption` — each `React.ComponentProps<"table"|"thead"|...>` passthrough with `cn()`-merged class defaults. `TableHead` renders `<th scope="col">`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/ui/table.test.tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./table";

describe("Table primitive", () => {
  it("renders a semantic table with column headers and rows", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>USDT</TableCell>
            <TableCell>$10</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["Asset", "Value"]);
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("marks header cells with scope=col for a11y", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    expect(screen.getByRole("columnheader")).toHaveAttribute("scope", "col");
  });

  it("merges custom className onto the cell", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell className="text-right">x</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole("cell")).toHaveClass("text-right");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @handshake-agent/web test -- components/ui/table.test.tsx`
Expected: FAIL — cannot resolve `./table`.

- [ ] **Step 3: Write the primitive**

```tsx
// web/components/ui/table.tsx
"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom border-collapse", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-border", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn("border-b border-border", className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      scope="col"
      data-slot="table-head"
      className={cn(
        "px-[22px] py-3.5 text-left align-middle text-xs font-bold tracking-widest whitespace-nowrap text-muted-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-[22px] py-[15px] align-middle", className)}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @handshake-agent/web test -- components/ui/table.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/ui/table.tsx web/components/ui/table.test.tsx
git commit -m "feat(web): add canonical Table primitive"
```

---

### Task 2: `web` `shared/DataTable`

**Files:**

- Create: `web/types/data-table.ts`
- Create: `web/components/shared/data-table.tsx`
- Test: `web/components/shared/data-table.test.tsx`

**Interfaces:**

- Consumes: `Table…` from Task 1.
- Produces:
  - `DataTableColumn<Row>` = `{ key: string; header: ReactNode; align?: "left"|"right"|"center"; widthClassName?: string; cellClassName?: string; render: (row: Row) => ReactNode }`
  - `DataTableProps<Row>` = `{ ariaLabel: string; columns: DataTableColumn<Row>[]; rows: Row[]; getRowKey: (row: Row, index: number) => string; hideHeader?: boolean; empty?: ReactNode; className?: string }`
  - `DataTable<Row>(props): JSX.Element` — renders `<Table aria-label=…>`; when `rows` is empty and `empty` is provided, renders `empty` instead of an empty `<tbody>`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/shared/data-table.test.tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataTable } from "./data-table";
import type { DataTableColumn } from "@/types/data-table";

interface Row {
  id: string;
  name: string;
  value: string;
}
const rows: Row[] = [
  { id: "1", name: "USDT", value: "$10" },
  { id: "2", name: "TRX", value: "$2" },
];
const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "Asset", render: (r) => r.name },
  { key: "value", header: "Value", align: "right", render: (r) => r.value },
];

describe("DataTable", () => {
  it("renders a named table with headers and one row per item", () => {
    render(
      <DataTable
        ariaLabel="Assets"
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
      />,
    );
    const table = screen.getByRole("table", { name: "Assets" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Asset", "Value"]);
    // header row + 2 data rows
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("TRX")).toBeInTheDocument();
  });

  it("hides the header row but stays a table when hideHeader is set", () => {
    render(
      <DataTable
        ariaLabel="Recent activity"
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        hideHeader
      />,
    );
    const table = screen.getByRole("table", { name: "Recent activity" });
    expect(within(table).queryAllByRole("columnheader")).toHaveLength(0);
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("renders the empty fallback when there are no rows", () => {
    render(
      <DataTable
        ariaLabel="Assets"
        columns={columns}
        rows={[]}
        getRowKey={(r) => r.id}
        empty={<p>Nothing yet</p>}
      />,
    );
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @handshake-agent/web test -- components/shared/data-table.test.tsx`
Expected: FAIL — cannot resolve `./data-table`.

- [ ] **Step 3: Write the types**

```ts
// web/types/data-table.ts
import type { ReactNode } from "react";

/** One column of a DataTable. */
export interface DataTableColumn<Row> {
  /** Stable key for the column (React key for cells). */
  key: string;
  /** Header content (not shown when the table hides its header). */
  header: ReactNode;
  /** Cell + header text alignment. Default "left". */
  align?: "left" | "right" | "center";
  /** Optional fixed-width utility class, e.g. "w-[42%]". */
  widthClassName?: string;
  /** Extra classes for the body cell. */
  cellClassName?: string;
  /** Render the body cell for a row. */
  render: (row: Row) => ReactNode;
}

/** Props for the generic, column-config-driven DataTable. */
export interface DataTableProps<Row> {
  /** Accessible name (aria-label) — a table must be identifiable, esp. with >1 on a page. */
  ariaLabel: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row, index: number) => string;
  /** Render rows without a visible header row (still a semantic table). */
  hideHeader?: boolean;
  /** Rendered instead of the table when rows is empty. */
  empty?: ReactNode;
  className?: string;
}
```

- [ ] **Step 4: Write the component**

```tsx
// web/components/shared/data-table.tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { DataTableColumn, DataTableProps } from "@/types/data-table";

const ALIGN: Record<NonNullable<DataTableColumn<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

/**
 * Column-config-driven table. Presentational only (no data fetching) — the
 * single canonical way to render a list of records (root §13.1). Renders a real
 * <table> via the Table primitive; `hideHeader` keeps table semantics without a
 * visible header row; `empty` replaces the table when there are no rows.
 */
export function DataTable<Row>({
  ariaLabel,
  columns,
  rows,
  getRowKey,
  hideHeader = false,
  empty,
  className,
}: DataTableProps<Row>) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>;

  return (
    <Table aria-label={ariaLabel} className={className}>
      {!hideHeader && (
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  col.widthClassName,
                  col.align && ALIGN[col.align],
                )}
              >
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
      )}
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={getRowKey(row, i)}>
            {columns.map((col) => (
              <TableCell
                key={col.key}
                className={cn(col.align && ALIGN[col.align], col.cellClassName)}
              >
                {col.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @handshake-agent/web test -- components/shared/data-table.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add web/types/data-table.ts web/components/shared/data-table.tsx web/components/shared/data-table.test.tsx
git commit -m "feat(web): add shared DataTable over the Table primitive"
```

---

### Task 3: overview constants + section prop types

**Files:**

- Create: `web/constants/overview.ts`
- Create: `web/types/overview.ts`

**Interfaces:**

- Consumes: `ChatAction` (`@/lib/schemas`), `WalletAsset` (`@/lib/schemas`), `ActivityGroup`/`ActivityItem` (`@/lib/schemas`), `DataTableColumn` (Task 2), `Money`/`StatusPill`/`AssetIcon` for column renderers (imported in the section files, not here — constants stay presentation-light and hold only data + column _config_, with renderers defined in the section files to avoid a constants→components import).
- Produces:
  - `HERO_ACTIONS: { action: ChatAction; label: string; primary: boolean }[]`
  - `BalanceHeroProps`, `AssetsTableProps`, `RecentActivityTableProps` (types/overview.ts)

Note: the column _configs_ (`ASSET_COLUMNS`, `ACTIVITY_COLUMNS`) contain JSX renderers, so they live **in their section files** (Tasks 5–6), not in `constants/`. `constants/overview.ts` holds only `HERO_ACTIONS` (pure data). This respects the layering (`constants/` must not import from `components/`).

- [ ] **Step 1: Write the constants (pure data — no test needed beyond typecheck; it is a data module)**

```ts
// web/constants/overview.ts
import type { ChatAction } from "@/lib/schemas";

/** Hero quick-actions, in display order. `swap` is filtered by capability at render. */
export const HERO_ACTIONS: {
  action: ChatAction;
  label: string;
  primary: boolean;
}[] = [
  { action: "buy", label: "Buy", primary: true },
  { action: "send", label: "Send", primary: false },
  { action: "receive", label: "Receive", primary: false },
  { action: "swap", label: "Swap", primary: false },
];
```

- [ ] **Step 2: Write the section prop types**

```ts
// web/types/overview.ts
import type { WalletAsset, ActivityGroup, ChatAction } from "@/lib/schemas";

export interface BalanceHeroProps {
  /** Formatted total balance string, or "—" when unavailable. */
  total: string;
  /** Whether the swap capability is enabled (drives the Swap button). */
  canSwap: boolean;
  onQuickAction: (action: ChatAction, label: string) => void;
}

export interface AssetsTableProps {
  assets: WalletAsset[];
}

export interface RecentActivityTableProps {
  groups: ActivityGroup[];
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @handshake-agent/web typecheck`
Expected: PASS (no errors from the new files).

- [ ] **Step 4: Commit**

```bash
git add web/constants/overview.ts web/types/overview.ts
git commit -m "refactor(web): extract overview hero constants and section prop types"
```

---

### Task 4: `BalanceHero` section

**Files:**

- Create: `web/components/desktop/overview/balance-hero.tsx`
- Test: `web/components/desktop/overview/balance-hero.test.tsx`

**Interfaces:**

- Consumes: `BalanceHeroProps` (Task 3), `HERO_ACTIONS` (Task 3), `Money` (`@/components/shared/money`), `chipLabel` (`@/lib/chat/flow`), `cn`.
- Produces: `BalanceHero(props: BalanceHeroProps): JSX.Element`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/desktop/overview/balance-hero.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BalanceHero } from "./balance-hero";

describe("BalanceHero", () => {
  it("shows the total balance label and value", () => {
    render(<BalanceHero total="₦1,000" canSwap onQuickAction={() => {}} />);
    expect(screen.getByText(/Total balance/i)).toBeInTheDocument();
    expect(screen.getByText("₦1,000")).toBeInTheDocument();
  });

  it("renders all four actions when swap is enabled", () => {
    render(<BalanceHero total="₦0" canSwap onQuickAction={() => {}} />);
    ["Buy", "Send", "Receive", "Swap"].forEach((label) =>
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument(),
    );
  });

  it("hides Swap when the capability is disabled", () => {
    render(<BalanceHero total="₦0" canSwap={false} onQuickAction={() => {}} />);
    expect(
      screen.queryByRole("button", { name: "Swap" }),
    ).not.toBeInTheDocument();
  });

  it("fires onQuickAction with the action and a label", async () => {
    const onQuickAction = vi.fn();
    const user = userEvent.setup();
    render(<BalanceHero total="₦0" canSwap onQuickAction={onQuickAction} />);
    await user.click(screen.getByRole("button", { name: "Buy" }));
    expect(onQuickAction).toHaveBeenCalledWith("buy", expect.any(String));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @handshake-agent/web test -- components/desktop/overview/balance-hero.test.tsx`
Expected: FAIL — cannot resolve `./balance-hero`.

- [ ] **Step 3: Write the component** (markup lifted verbatim from `overview-page.tsx` lines 134–168 to preserve pixels)

```tsx
// web/components/desktop/overview/balance-hero.tsx
import { Money } from "@/components/shared/money";
import { HERO_ACTIONS } from "@/constants/overview";
import { chipLabel } from "@/lib/chat/flow";
import { cn } from "@/lib/utils";
import type { BalanceHeroProps } from "@/types/overview";

/** Balance hero + quick-action buttons. Swap is hidden until crypto.swap is on. */
export function BalanceHero({
  total,
  canSwap,
  onQuickAction,
}: BalanceHeroProps) {
  const actions = canSwap
    ? HERO_ACTIONS
    : HERO_ACTIONS.filter((a) => a.action !== "swap");

  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-5 rounded-[18px] bg-gradient-to-b from-primary to-primary-deep px-[26px] py-6 text-primary-foreground">
      <div className="flex-1">
        <p className="text-[13px] font-semibold text-primary-foreground/70">
          Total balance
        </p>
        <Money
          value={total}
          as="div"
          className="mt-0.5 text-[40px] font-extrabold tracking-tight tabular-nums"
        />
      </div>
      <div className="flex gap-[10px]">
        {actions.map(({ action, label, primary }) => (
          <button
            key={action}
            type="button"
            aria-label={label}
            onClick={() => onQuickAction(action, chipLabel(action))}
            className={cn(
              "cursor-pointer rounded-[12px] px-5 py-[11px] text-sm font-bold transition-opacity outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary-foreground/80 focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
              primary
                ? "bg-accent text-accent-foreground"
                : "border border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @handshake-agent/web test -- components/desktop/overview/balance-hero.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/desktop/overview/balance-hero.tsx web/components/desktop/overview/balance-hero.test.tsx
git commit -m "refactor(web): extract overview BalanceHero section"
```

---

### Task 5: `AssetsTable` section (via DataTable)

**Files:**

- Create: `web/components/desktop/overview/assets-table.tsx`
- Test: `web/components/desktop/overview/assets-table.test.tsx`

**Interfaces:**

- Consumes: `AssetsTableProps` (Task 3), `DataTable`/`DataTableColumn` (Task 2), `AssetIcon` (`@/components/shared/asset-icon`), `Money` (`@/components/shared/money`), `WalletAsset` (`@/lib/schemas`).
- Produces: `AssetsTable(props: AssetsTableProps): JSX.Element` — a table with `aria-label="Assets"`, columns `Asset` / `Holdings` (right) / `Value` (right).

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/desktop/overview/assets-table.test.tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssetsTable } from "./assets-table";
import type { WalletAsset } from "@/lib/schemas";

const assets: WalletAsset[] = [
  {
    sym: "USDT",
    name: "Tether USD",
    sub: "TRC-20",
    amount: "50 USDT",
    value: "₦80,000",
    change: "+0.01%",
    tint: "#26A17B",
    logoUrl: null,
  } as WalletAsset,
];

describe("AssetsTable", () => {
  it("renders a named table with Asset/Holdings/Value headers", () => {
    render(<AssetsTable assets={assets} />);
    const table = screen.getByRole("table", { name: "Assets" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Asset", "Holdings", "Value"]);
  });

  it("renders one row per asset with its name and value", () => {
    render(<AssetsTable assets={assets} />);
    const table = screen.getByRole("table", { name: "Assets" });
    expect(within(table).getByText("Tether USD")).toBeInTheDocument();
    expect(within(table).getByText("₦80,000")).toBeInTheDocument();
    // header row + 1 asset row
    expect(within(table).getAllByRole("row")).toHaveLength(2);
  });

  it("does not advertise Price or 24h columns it cannot fill", () => {
    render(<AssetsTable assets={assets} />);
    expect(screen.queryByText("Price")).not.toBeInTheDocument();
    expect(screen.queryByText("24h")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @handshake-agent/web test -- components/desktop/overview/assets-table.test.tsx`
Expected: FAIL — cannot resolve `./assets-table`.

- [ ] **Step 3: Write the component** (cell renderers reproduce `overview-page.tsx` lines 206–233)

```tsx
// web/components/desktop/overview/assets-table.tsx
import { AssetIcon } from "@/components/shared/asset-icon";
import { Money } from "@/components/shared/money";
import { DataTable } from "@/components/shared/data-table";
import type { DataTableColumn } from "@/types/data-table";
import type { AssetsTableProps } from "@/types/overview";
import type { WalletAsset } from "@/lib/schemas";

// Price and 24h columns are intentionally absent — no backend source (finding #7).
const COLUMNS: DataTableColumn<WalletAsset>[] = [
  {
    key: "asset",
    header: "Asset",
    widthClassName: "w-[42%]",
    render: (a) => (
      <div className="flex items-center gap-3">
        <AssetIcon sym={a.sym} tint={a.tint} logoUrl={a.logoUrl} size="sm" />
        <div>
          <p className="text-[14.5px] font-bold text-foreground">{a.name}</p>
          <p className="text-xs text-muted-foreground">{a.sub}</p>
        </div>
      </div>
    ),
  },
  {
    key: "holdings",
    header: "Holdings",
    align: "right",
    widthClassName: "w-[29%]",
    render: (a) => (
      <Money
        value={a.amount.split(" ")[0]}
        className="text-sm text-foreground"
      />
    ),
  },
  {
    key: "value",
    header: "Value",
    align: "right",
    widthClassName: "w-[29%]",
    render: (a) => (
      <Money
        value={a.value}
        className="text-[14.5px] font-bold text-foreground"
      />
    ),
  },
];

/** Holdings table for the overview page. */
export function AssetsTable({ assets }: AssetsTableProps) {
  return (
    <div className="rounded-[18px] border border-border bg-card">
      <DataTable
        ariaLabel="Assets"
        columns={COLUMNS}
        rows={assets}
        getRowKey={(a) => a.sym + a.name}
        className="table-fixed"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @handshake-agent/web test -- components/desktop/overview/assets-table.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/desktop/overview/assets-table.tsx web/components/desktop/overview/assets-table.test.tsx
git commit -m "refactor(web): extract overview AssetsTable via DataTable"
```

---

### Task 6: `RecentActivityTable` section (headerless DataTable)

**Files:**

- Create: `web/components/desktop/overview/recent-activity-table.tsx`
- Test: `web/components/desktop/overview/recent-activity-table.test.tsx`

**Interfaces:**

- Consumes: `RecentActivityTableProps` (Task 3), `DataTable`/`DataTableColumn` (Task 2), `Money`, `StatusPill`, `QueryEmptyState` (`@/components/shared/query-states`), `ActivityItem` (`@/lib/schemas`).
- Produces: `RecentActivityTable(props): JSX.Element` — a headerless table `aria-label="Recent activity"` under a "Recent activity" heading; empty → `QueryEmptyState`. The section's outer wrapper must **not** carry `flex-1` (regression guard from the existing overview test).

- [ ] **Step 1: Write the failing test**

```tsx
// web/components/desktop/overview/recent-activity-table.test.tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecentActivityTable } from "./recent-activity-table";
import type { ActivityGroup } from "@/lib/schemas";

const groups: ActivityGroup[] = [
  {
    group: "Today",
    items: [
      {
        id: "t1",
        dir: "in",
        icon: "↓",
        tint: "#e8f5e9",
        col: "#1b5e20",
        title: "Bought USDT",
        sub: "Today · 10:00",
        amount: "+ 50 USDT",
        status: "Done",
        statusTone: "success",
      },
    ],
  },
];

describe("RecentActivityTable", () => {
  it("renders the heading and a named table of rows", () => {
    render(<RecentActivityTable groups={groups} />);
    expect(screen.getByText(/Recent activity/i)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Recent activity" });
    expect(within(table).getByText("Bought USDT")).toBeInTheDocument();
  });

  it("is headerless (no column headers) but still a semantic table", () => {
    render(<RecentActivityTable groups={groups} />);
    const table = screen.getByRole("table", { name: "Recent activity" });
    expect(within(table).queryAllByRole("columnheader")).toHaveLength(0);
  });

  it("shows the empty state when there are no items", () => {
    render(<RecentActivityTable groups={[]} />);
    expect(screen.getByText(/No recent activity/i)).toBeInTheDocument();
  });

  it("does not height-cap its wrapper (rows must not be clipped)", () => {
    render(<RecentActivityTable groups={groups} />);
    const heading = screen.getByText(/Recent activity/i);
    const card = heading.parentElement;
    expect(card?.className ?? "").not.toMatch(/\bflex-1\b/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @handshake-agent/web test -- components/desktop/overview/recent-activity-table.test.tsx`
Expected: FAIL — cannot resolve `./recent-activity-table`.

- [ ] **Step 3: Write the component** (row renderer reproduces `overview-page.tsx` lines 257–294; icon tint/col stay inline `style` — they are data)

```tsx
// web/components/desktop/overview/recent-activity-table.tsx
import { Money } from "@/components/shared/money";
import { StatusPill } from "@/components/shared/status-pill";
import { DataTable } from "@/components/shared/data-table";
import { QueryEmptyState } from "@/components/shared/query-states";
import type { DataTableColumn } from "@/types/data-table";
import type { RecentActivityTableProps } from "@/types/overview";
import type { ActivityItem } from "@/lib/schemas";

const COLUMNS: DataTableColumn<ActivityItem>[] = [
  {
    key: "icon",
    header: "",
    widthClassName: "w-[47px]",
    render: (item) => (
      <div
        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] text-base font-bold"
        style={{ backgroundColor: item.tint, color: item.col }}
      >
        {item.icon}
      </div>
    ),
  },
  {
    key: "body",
    header: "",
    render: (item) => (
      <div>
        <p className="text-sm font-bold text-foreground">{item.title}</p>
        <p className="text-xs text-muted-foreground tabular-nums">{item.sub}</p>
      </div>
    ),
  },
  {
    key: "amount",
    header: "",
    align: "right",
    render: (item) => (
      <div className="text-right">
        <Money
          value={item.amount}
          as="p"
          className="text-sm font-bold text-foreground"
        />
        <StatusPill tone={item.statusTone} className="mt-0.5 text-[11px]">
          {item.status}
        </StatusPill>
      </div>
    ),
  },
];

/**
 * Recent-activity ledger. A headerless semantic table (root §13 a11y) that
 * grows with its content — the wrapper must NOT be `flex-1`, or the page's
 * overflow-y-auto scroll would clip overflowing rows (regression guard).
 */
export function RecentActivityTable({ groups }: RecentActivityTableProps) {
  const items = groups.flatMap((g) => g.items);
  return (
    <div className="rounded-[18px] border border-border bg-card">
      <p className="border-b border-border px-[22px] pt-[15px] pb-[11px] text-xs font-bold tracking-widest text-muted-foreground uppercase">
        Recent activity
      </p>
      <DataTable
        ariaLabel="Recent activity"
        columns={COLUMNS}
        rows={items}
        getRowKey={(item) => item.id}
        hideHeader
        empty={
          <QueryEmptyState
            title="No recent activity"
            description="Your transactions will show up here."
          />
        }
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @handshake-agent/web test -- components/desktop/overview/recent-activity-table.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/components/desktop/overview/recent-activity-table.tsx web/components/desktop/overview/recent-activity-table.test.tsx
git commit -m "refactor(web): extract overview RecentActivityTable as a semantic table"
```

---

### Task 7: Slim `overview-page.tsx` to an orchestrator + update its test

**Files:**

- Modify: `web/components/desktop/overview-page.tsx` (replace the inline hero/assets/activity markup with the three sections)
- Modify: `web/components/desktop/overview-page.test.tsx` (disambiguate the now-two tables by accessible name)

**Interfaces:**

- Consumes: `BalanceHero` (Task 4), `AssetsTable` (Task 5), `RecentActivityTable` (Task 6). Keeps `PageWithQuickActionProps`, the `useBalances`/`useWalletAssets`/`useActivityFeed` hooks, `useCapabilities`, `retryAll`, and the loading/error/empty branches unchanged.
- Produces: `OverviewPage(props: PageWithQuickActionProps): JSX.Element` (unchanged signature).

- [ ] **Step 1: Update the behavior-guard test first** (two tables now exist → scope by name; keep every other assertion)

Replace the `renders the holdings as a semantic table…` test body and the two-table-affected assertions with name-scoped lookups:

```tsx
// in web/components/desktop/overview-page.test.tsx — replace the semantic-table test:
it("renders the holdings as a semantic table with real column headers", async () => {
  render(<OverviewPage onQuickAction={() => {}} />, { wrapper });
  await waitFor(() => {
    expect(screen.getByText(/Tether USD/i)).toBeInTheDocument();
  });
  const table = screen.getByRole("table", { name: "Assets" });
  const headers = within(table)
    .getAllByRole("columnheader")
    .map((h) => h.textContent);
  expect(headers).toEqual(["Asset", "Holdings", "Value"]);
  // Header row + one body row per fixture asset (3 assets).
  expect(within(table).getAllByRole("row").length).toBe(4);
});

it("renders recent activity as its own semantic table", async () => {
  render(<OverviewPage onQuickAction={() => {}} />, { wrapper });
  await screen.findByText(/Recent activity/i);
  expect(
    screen.getByRole("table", { name: "Recent activity" }),
  ).toBeInTheDocument();
});
```

Keep the existing `renders recent activity section` (checks "Bought USDT"), the `does not height-cap…` test (now guards `RecentActivityTable`'s wrapper — still asserts the "Recent activity" heading's parent has no `flex-1`), the Price/24h absence test, the Asset/Holdings/Value column test (still passes — those texts exist once, in the Assets table), the hero-action test, loading, and error tests unchanged.

- [ ] **Step 2: Run the test to verify it FAILS against the current (still-inline) page**

Run: `pnpm --filter @handshake-agent/web test -- components/desktop/overview-page.test.tsx`
Expected: FAIL — the current page has one unnamed table, so `getByRole("table", { name: "Assets" })` finds nothing and there is no "Recent activity" table.

- [ ] **Step 3: Rewrite the page as an orchestrator**

```tsx
// web/components/desktop/overview-page.tsx
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BalanceHero } from "@/components/desktop/overview/balance-hero";
import { AssetsTable } from "@/components/desktop/overview/assets-table";
import { RecentActivityTable } from "@/components/desktop/overview/recent-activity-table";
import {
  QueryErrorState,
  QueryEmptyState,
} from "@/components/shared/query-states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useBalances,
  useWalletAssets,
  useActivityFeed,
} from "@/lib/query/hooks";
import { qk } from "@/lib/query/keys";
import { useCapabilities } from "@/lib/query/capabilities";
import { cn } from "@/lib/utils";
import type { PageWithQuickActionProps } from "@/types/components";

/**
 * Desktop overview page — orchestrator. Owns the three data hooks and the four
 * async branches (loading / error / empty / data); composes the Balance hero,
 * Assets table, and Recent-activity sections. All presentational markup lives in
 * those section components (root §16).
 */
export function OverviewPage({
  onQuickAction,
  className,
}: PageWithQuickActionProps) {
  const balances = useBalances();
  const assets = useWalletAssets();
  const activity = useActivityFeed();
  const queryClient = useQueryClient();
  const { canSwap } = useCapabilities();

  // One retry that re-fetches all three sections (the activity feed hook exposes
  // no refetch, so invalidation is the uniform path). Match by the key's first
  // segment so balances / walletAssets / activity all refetch.
  const RETRY_KEYS: string[] = [
    qk.balances[0],
    qk.walletAssets[0],
    qk.activity[0],
  ];
  const retryAll = () =>
    void queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        RETRY_KEYS.includes(q.queryKey[0] as string),
    });

  const isLoading =
    balances.isLoading || assets.isLoading || activity.isLoading;
  const isError = balances.isError || assets.isError || activity.isError;

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col gap-[18px] overflow-y-auto p-6",
          className,
        )}
      >
        <Skeleton className="h-[120px] rounded-[18px]" />
        <Skeleton className="h-[180px] rounded-[18px]" />
        <Skeleton className="h-[160px] rounded-[18px]" />
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <QueryErrorState
          title="Failed to load overview"
          description="Something went wrong loading your wallet. Check your connection and try again."
          onRetry={retryAll}
        />
      </div>
    );
  }

  const balanceData = balances.data;
  const assetData = assets.data ?? [];
  const activityData = activity.groups;

  if (!balanceData && assetData.length === 0 && activityData.length === 0) {
    return (
      <div
        className={cn("flex flex-1 items-center justify-center p-6", className)}
      >
        <QueryEmptyState
          title="Nothing here yet"
          description="Fund your wallet to see your balance and activity."
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-[18px] overflow-y-auto p-6",
        className,
      )}
    >
      <BalanceHero
        total={balanceData?.total ?? "—"}
        canSwap={canSwap}
        onQuickAction={onQuickAction}
      />
      <AssetsTable assets={assetData} />
      <RecentActivityTable groups={activityData} />
    </div>
  );
}
```

- [ ] **Step 4: Run the overview test to verify it PASSES**

Run: `pnpm --filter @handshake-agent/web test -- components/desktop/overview-page.test.tsx`
Expected: PASS (all tests, including the two new table assertions).

- [ ] **Step 5: Run the full web test suite (no regressions)**

Run: `pnpm --filter @handshake-agent/web test`
Expected: PASS — full suite green (was 875/875 per repo memory; now higher with the new section tests).

- [ ] **Step 6: Commit**

```bash
git add web/components/desktop/overview-page.tsx web/components/desktop/overview-page.test.tsx
git commit -m "refactor(web): make OverviewPage a thin orchestrator over extracted sections"
```

---

### Task 8: Types barrel + CLAUDE.md componentisation standards

**Files:**

- Create: `web/types/index.ts`
- Modify: `CLAUDE.md` (root — new §16)
- Modify: `web/CLAUDE.md` (componentisation + the visual runbook)
- Modify: `web-admin/CLAUDE.md` (componentisation)

**Interfaces:**

- Produces: `@/types` barrel (re-exports `./components`, `./data-table`, `./overview`). Existing `@/types/components` imports keep working; new code prefers `@/types`.

- [ ] **Step 1: Write the barrel**

```ts
// web/types/index.ts
// Barrel for web types. Import from "@/types". Per-feature files are split out of
// the historical components.ts as features are refactored (root §16).
export * from "./components";
export * from "./data-table";
export * from "./overview";
```

- [ ] **Step 2: Typecheck the barrel**

Run: `pnpm --filter @handshake-agent/web typecheck`
Expected: PASS (no duplicate-export collisions; `data-table`/`overview` names are unique).

- [ ] **Step 3: Add root `CLAUDE.md` §16** — insert after §15 (Documentation), before nothing else changes:

```markdown
## 16. Componentisation & modularisation (FE — web + web-admin)

The rails that keep pages small and reusable. Applies to `web` and `web-admin`.

1. **Pages/route files are orchestrators only.** A `page.tsx` (or a top-level view)
   holds data hooks, the four async branches (loading/error/empty/data), event
   handlers, and composition of section components — **no large inline section
   markup**. Extract each section (hero, table, list, toolbar, dialog) into its own
   component in `components/<feature>/`.
2. **No component may masquerade as a page.** A page lives in `app/`. A reusable
   view/section lives in `components/<feature>/`. Do not create `*-page.tsx`
   components that are really views (name them for what they are).
3. **Tabular data renders through the `Table` primitive via `shared/DataTable`.**
   No raw `<table>` and no div-grid "tables". `DataTable` is column-config driven
   (`columns`, `rows`, `getRowKey`, `ariaLabel`, optional `hideHeader`/`empty`).
   Every table has an `ariaLabel`.
4. **Hooks live in `hooks/`** — never a `useXxx` defined inside a component file.
5. **Constants live in `constants/`** — no magic array/label-map/enum-of-labels
   inline in a component. Column _configs_ that contain JSX renderers live in the
   section file (constants must not import from components).
6. **Types live in `types/`** — per-feature files (`types/<feature>.ts`) plus a
   `types/index.ts` barrel (import from `@/types`). Prop types are `XxxProps`;
   shared/domain shapes come from `@handshake-agent/contracts`. No inline
   interfaces beyond trivial locals.
7. **Size caps (from §13.3):** component ≤150 lines, file ≤300, function ≤40.
   Extract at the section boundary, not every element — a cohesive block stays one
   file.

Enforcement: `dependency-cruiser` keeps the layering (`app → components → lib →
types`; `hooks`/`constants` alongside `lib`, never importing from
`components`/`app`). Every wave ends on `pnpm lint && pnpm typecheck && pnpm test`
green and `pnpm depcruise` clean, plus a visual check of any affected surface.
```

- [ ] **Step 4: Add the componentisation section + visual runbook to `web/CLAUDE.md`**

Append a `## Componentisation (root §16)` section that: states pages/views are orchestrators; `Table`/`shared/DataTable` is the only table path; `hooks/`, `constants/`, `types/` (+ `@/types` barrel) are the homes for those concerns; and includes the **Visual Verification Runbook** (api on :3001, web on :3000, log in as a Docker test user via the dev-exposed OTP — `qa.fulltest@example.com`).

- [ ] **Step 5: Add the componentisation section to `web-admin/CLAUDE.md`**

Append a `## Componentisation (root §16)` section: route files compose `<AppShell>` + a route orchestrator; lists render via the `Table` primitive + a `shared/DataTable`; `hooks/` (promoted from `lib/hooks/` in the admin wave), `constants/`, and per-feature `types/` are the homes for those concerns.

- [ ] **Step 6: Verify docs + gates**

Run: `pnpm --filter @handshake-agent/web typecheck && pnpm --filter @handshake-agent/web lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/types/index.ts CLAUDE.md web/CLAUDE.md web-admin/CLAUDE.md
git commit -m "docs(repo): add componentisation & modularisation standards (root §16 + web + web-admin)"
```

---

### Task 9: Full gate + visual verification, then open the PR

**Files:** none (verification + PR).

- [ ] **Step 1: Run every gate for `web` from the repo root**

```bash
pnpm --filter @handshake-agent/web lint
pnpm --filter @handshake-agent/web typecheck
pnpm --filter @handshake-agent/web test
pnpm depcruise
```

Expected: all green; `depcruise` clean (no new boundary violations — the new `constants/` and `overview/` folders import only downward).

- [ ] **Step 2: Confirm no file exceeds the caps**

Run:

```bash
wc -l web/components/desktop/overview-page.tsx web/components/desktop/overview/*.tsx web/components/shared/data-table.tsx web/components/ui/table.tsx
```

Expected: every file ≤150 lines (orchestrator well under 300).

- [ ] **Step 3: Visual verification (the Runbook above)**

Start api (:3001, background) + web (:3000, `preview_start`). Log in as `qa.fulltest@example.com` via the dev OTP. At desktop viewport, `preview_snapshot` + `preview_screenshot` the overview: confirm the Balance hero, the Assets table (Tether USD row, Asset/Holdings/Value headers), and the Recent-activity rows render and match the baseline captured at Runbook step 3. `preview_console_logs level:error` and `preview_network filter:failed` must show no new errors. Share the screenshot with the user.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin refactor/modularisation-foundation
gh pr create --title "refactor(web): Wave 0 — Table/DataTable primitives + overview componentisation + CLAUDE.md standards" \
  --body "Foundation for the componentisation program (spec: docs/superpowers/specs/2026-07-06-componentisation-modularisation-design.md). Adds the canonical Table primitive + shared DataTable, extracts the overview page into BalanceHero/AssetsTable/RecentActivityTable sections, introduces web/constants + web/types per-feature + @/types barrel, and records the standards in CLAUDE.md (root §16 + web + web-admin). No visible change; overview verified visually. All gates green."
```

- [ ] **Step 5: Report** the PR URL, the gate results, and the before/after overview screenshots to the user.

---

## Self-Review

**Spec coverage (Wave 0 slice of spec §9):**

- `Table` (web) → Task 1. `DataTable` (web) → Task 2. ✓ (admin `DataTable` deferred to Wave 3 per spec §9 Wave 3 — this plan is web-first; noted, not a gap.)
- `constants/` created → Task 3. ✓
- `types/` per-feature + `@/types` barrel started → Tasks 3, 8. (The full 127-site `@/types/components` → `@/types` codemod is intentionally deferred to a later web wave to keep this PR focused and visual; new per-feature files + barrel establish the convention now. Recorded here so it is not lost.)
- CLAUDE.md standards (root + web + web-admin) → Task 8. ✓
- Overview componentisation pilot (spec §7 worked example) → Tasks 4–7. ✓
- Full TDD per extracted piece (spec §8) → every section/primitive has a failing-first test. ✓
- Visual verification (user requirement) → Task 9 + Runbook. ✓
- `hooks/` promotion (admin) + inline-hook hoisting → deferred to Wave 2/3 (spec §9). Not in scope here; recorded.

**Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. The two deferrals (types codemod, admin DataTable/hooks) are explicit scope notes with a home wave, not placeholders.

**Type consistency:** `DataTableColumn`/`DataTableProps` defined in Task 2 (`web/types/data-table.ts`) and consumed with the same field names in Tasks 5–6. `BalanceHeroProps`/`AssetsTableProps`/`RecentActivityTableProps` defined in Task 3 and consumed in Tasks 4–6. `HERO_ACTIONS` shape defined in Task 3, consumed in Task 4. `ariaLabel` values ("Assets", "Recent activity") are consistent between the section components (Tasks 5–6) and the updated overview test (Task 7).
