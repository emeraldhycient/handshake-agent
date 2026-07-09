# web-admin — CLAUDE.md

Next.js 16 (App Router, React 19) **admin console** — a separate app from `web/`, for operating the platform (config console, KYC review, transaction monitoring, treasury). Read the root [`CLAUDE.md`](../CLAUDE.md) first and [`web-admin/AGENTS.md`](AGENTS.md) (Next 16 diverges from training data — read `node_modules/next/dist/docs/` before writing Next-specific code).

## What this app is (and isn't)

- It is the **admin/operator surface**, not a user surface. The user-facing chat/wallet app is `web/`. The agent and the deterministic execution engine live in `api/`.
- It has its **own auth and its own Zustand stores**, separate from `web/`. Do not import from `web/`; do not share session/cookie state with it. Admin auth is a distinct, more-privileged flow.
- It **reuses `@handshake-agent/contracts`** for every shape that crosses the FE/BE boundary (admin DTOs live under `@handshake-agent/contracts/admin`). Never redefine a shape that already exists in contracts.

## Conventions (identical to web/)

- **Strict downward layering**: `app → components → lib → types`. `components/` must not import from `app/`; `lib/` must not import from `components/` (enforced by `dependency-cruiser`). Components are pure UI — no `fetch`, no `localStorage`, no business logic.
- **TanStack Query** = all server state (set `staleTime` per resource). **Zustand** = client/UI state only. **Axios** = one configured instance in `lib/api/` with interceptors (auth, error normalization, `Idempotency-Key` on every mutation). **Zod + react-hook-form** for every form; parse the body before each request and the response after. The FE gate is UX, never the only check.
- **Tailwind v4 is CSS-first**: all config lives in `app/globals.css` (`@import "tailwindcss"`, `@theme inline`, `@custom-variant dark`, oklch tokens) — copied verbatim from `web/` so the design tokens match. **There is no `tailwind.config.js` — do not create one.** The only PostCSS plugin is `@tailwindcss/postcss`.
- **shadcn**, style `radix-vega`: `cd web-admin && pnpm dlx shadcn@latest add <name>` — lands in `components/ui` (alias `@/components/ui`). `cn()` is in `lib/utils.ts`. **`radix-ui` is the unified package** — never add individual `@radix-ui/react-*` packages.
- Every async UI has four branches: **loading / error / empty / data**. Tokens only — no hex literals.

## Commands

```bash
pnpm --filter @handshake-agent/web-admin dev          # Turbopack dev (default in Next 16)
pnpm --filter @handshake-agent/web-admin build        # Turbopack build
pnpm --filter @handshake-agent/web-admin lint         # flat-config ESLint
pnpm --filter @handshake-agent/web-admin typecheck    # tsc --noEmit
pnpm --filter @handshake-agent/web-admin test         # vitest run
```

## Componentisation (root §16)

Same rails as `web` (see root §16). Route files compose `<AppShell>` + a **route orchestrator** (`components/admin/<x>-page.tsx`) that holds data hooks, the four async branches, and composition — sections extract into `components/admin/<feature>/`.

- **Lists/tables** render through the `Table` primitive (`components/ui/table.tsx`) via the **shared `DataTable`** — it exists at `components/shared/data-table.tsx`; **every new table must use it** (column-config driven, one `ariaLabel` per table). Retire the remaining raw `<table>` sites when touching them.
- **Hooks** → `hooks/` is the target home, but the promotion is **still pending**: hooks currently live in `lib/hooks/` (there is no `hooks/` directory yet — move them in the admin componentisation wave, don't add new ones to `lib/hooks/`). **Constants** → `constants/<feature>.ts`. **Types** → per-feature `types/<feature>.ts` + a `types/index.ts` barrel (the historical `types/components.ts` has grown to ~2,900 lines and still needs splitting); import from `@/types`.
- **Money display** goes through `formatFiat(value, currency)` in `lib/format.ts` (mirrors `web/`): symbol + precision hydrate from the admin catalog read via `hydrateFiatDisplay`, `FIAT_SYMBOLS` is the offline fallback. No hand-rolled `₦`/per-currency forks.
- **Maker-checker + step-up**: privileged writes confirm through `MakerCheckerModal` (`components/admin/flows/maker-checker-modal.tsx`). Its default `mode="immediate"` states honestly that the change applies on confirm; pass `mode="dual-control"` **only** where the endpoint actually raises a `ChangeRequest` for a second admin — never label an immediate write as dual-control. The **sole step-up surface** is the server-driven 403 → `StepUpDialog` (`components/admin/step-up-dialog.tsx`) retry; do not pre-empt step-up client-side.
- **Nav ↔ access lock-step**: every `NAV_GROUPS` item (`constants/admin-nav.ts`) must stay in lock-step with `lib/route-access.ts` — a `__tests__/route-access.test.ts` suite asserts it. Adding a route to the nav auto-covers the command palette and `RouteGuard`; a `menu: null` leaks the route to all admins, so set it deliberately.
- Size caps (root §13.3): component ≤150, file ≤300, function ≤40. The largest files (`user-detail.tsx`, `transaction-detail.tsx`, `operator-dashboard.tsx`, `lib/query/hooks.ts`) are the primary decomposition targets.
- Every admin PR is verified visually (log in via the admin app's auth flow before/after the change).
