# web — CLAUDE.md

Next.js 16 (App Router, React 19) frontend: the system of record's UI and the full channel fallback for WhatsApp. Read the root [`CLAUDE.md`](../CLAUDE.md) first and [`web/AGENTS.md`](AGENTS.md) (Next 16 diverges from training data — read `node_modules/next/dist/docs/` before writing Next-specific code).

## Architecture — strict downward layering

```
app/          # routes + composition ONLY. Arranges components, passes props. No new primitives, no business logic.
components/
  ui/         # shadcn primitives (generated). One canonical primitive per concept.
  shared/     # cross-cutting composed primitives
  <feature>/  # feature components (chat, wallet, kyc, tickets)
lib/          # the ONLY layer that talks to the world
  api/        # the single Axios instance + typed clients (parse with Zod before request)
  query/      # TanStack Query keys + hooks (useBalances, useQuoteBuy, …)
  store/      # Zustand stores — client/UI state only
  schemas/    # local Zod schemas (shared shapes come from @handshake-agent/contracts)
hooks/
types/        # interfaces/types, or re-exports of contracts' inferred types
```

Imports flow strictly down: `app → components → lib → types`. **`components/` must not import from `app/`; `lib/` must not import from `components/`** (enforced by `dependency-cruiser`). Components are pure UI — no `fetch`, no `localStorage`, no business logic.

## State, data, validation (one job each — root §5)

- **TanStack Query** = all server state. Never `useEffect` + `fetch`. Set `staleTime` per resource. Read the `/config` endpoint here to drive which services are enabled.
- **Zustand** = client/UI state only (chat composer, modal open-state, view prefs). Never a server cache.
- **Axios** = one configured instance in `lib/api/` with interceptors (auth, error normalization, `Idempotency-Key` on every mutation).
- **Zod + react-hook-form** for every form (`zodResolver`). Schemas come from `@handshake-agent/contracts` when they mirror a request DTO; derive types with `z.infer`. Parse the body before each request and the response after. The FE gate is UX, never the only check.
- Every async UI has four branches: **loading / error / empty / data**.

## UI — Tailwind v4 + shadcn

- **Tailwind v4 is CSS-first.** All config lives in `app/globals.css` (`@import "tailwindcss"`, `@theme inline`, `@custom-variant dark`, oklch tokens). **There is no `tailwind.config.js` — do not create one.** The only PostCSS plugin is `@tailwindcss/postcss`.
- **shadcn**, style `radix-vega`. Add components from this package: `pnpm dlx shadcn@latest add <name>` — they land in `components/ui` (alias `@/components/ui`). `cn()` is in `lib/utils.ts`.
- **`radix-ui` is the unified package**: `import { Slot } from "radix-ui"` — never add individual `@radix-ui/react-*` packages.
- Tokens only — no hex literals. Status semantics fixed (`success`/`warn`/`danger`/`info`/neutral). `next-themes` is wired (`attribute="class"`).

## Commands

```bash
pnpm --filter @handshake-agent/web dev          # Turbopack dev (default in Next 16; outputs to .next/dev)
pnpm --filter @handshake-agent/web build        # Turbopack build
pnpm --filter @handshake-agent/web lint         # flat-config ESLint (next/core-web-vitals + typescript)
pnpm --filter @handshake-agent/web typecheck    # tsc --noEmit
pnpm --filter @handshake-agent/web format       # prettier + prettier-plugin-tailwindcss
cd web && pnpm dlx shadcn@latest add button dialog input    # add primitives
cd web && pnpm next typegen                                 # regenerate typed-route params
```

## Stack gotchas (verified — Next `16.2.6`, React `19.2.4`, Tailwind `4.3.1`)

- **Turbopack is the default** for `dev` and `build` — no `--turbopack` flag. `next lint` was **removed**; `next build` no longer lints. Linting is the ESLint CLI.
- **Async request APIs:** `cookies()`, `headers()`, `draftMode()`, and route `params`/`searchParams` are **Promises** — `await` them. Synchronous access was removed.
- `middleware` is deprecated (renamed `proxy`, Node runtime only). `next/image` defaults changed (`minimumCacheTTL`, `qualities`; `images.domains` → `remotePatterns`). Caching opt-in is now top-level `cacheComponents` + the stable `'use cache'` directive.
- Monorepo: set `transpilePackages: ['@handshake-agent/contracts']` and `outputFileTracingRoot` in `next.config.ts` (silences the multi-lockfile root warning and traces files correctly).

## Testing (strict TDD, root §9)

Vitest + React Testing Library + `@testing-library/user-event`; Playwright for E2E. **Add a `test` script to `package.json`** (Vitest) so the `turbo test` gate covers the frontend (it currently has none). Run `pnpm exec playwright install` once after adding `@playwright/test`.

Run one file fast: `cd web && pnpm exec vitest run <path>` (the package `test` script does not narrow via a positional arg).

## Componentisation (root §16)

Pages/views are **orchestrators** — hooks + the four async branches + composition of section components. Extracted sections live beside their page in `components/<feature>/`.

- **Tables** render through the `Table` primitive (`components/ui/table.tsx`) via **`shared/DataTable`** (`components/shared/data-table.tsx`) — column-config driven, one `ariaLabel` per table, `hideHeader` for headerless semantic tables, `empty` for the empty branch. No raw `<table>` or div-grid tables.
- **Hooks** → `hooks/`. **Constants** → `constants/<feature>.ts` (JSX-bearing column configs stay in the section file). **Types** → `types/<feature>.ts` + the `types/index.ts` barrel; import from `@/types` (the legacy `@/types/components` path still resolves during the migration).
- Worked reference: the overview page (`components/desktop/overview-page.tsx` orchestrator + `overview/balance-hero.tsx` + `overview/assets-table.tsx` + `overview/recent-activity-table.tsx`).

### Visual verification runbook (every FE PR)

Docker is already up: `handshake-agent-db` (Postgres, host **:5544**), `handshake-agent-redis` (:6379). `api/.env` has real keys + `AUTH_DEV_EXPOSE_OTP=true`; `web/.env.local` points at the API on `:3001` with `NEXT_PUBLIC_USE_MOCK=false`.

1. Start API on **:3001** in the background: `cd api && PORT=3001 pnpm dev` (ts-node, no watch — `api/.env` sets `PORT=3000`, so override). Wait for "Nest application successfully started".
2. Start web with the preview tool (`launch.json` config **`web`**, :3000).
3. Log in as a Docker test user — **`qa.fulltest@example.com`** (active, verified, tier_1). Email-OTP: submit the email, read the dev-exposed OTP from the API response/stdout, submit it. (web persists only `ha.refreshToken`; a real UI login is the faithful path.)
4. Exercise the affected surface; capture a screenshot; confirm `console` errors and failed network requests are clean. Compare against a baseline captured before the change.
