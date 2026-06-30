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
