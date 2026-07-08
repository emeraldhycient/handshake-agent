# packages/contracts — CLAUDE.md

Shared Zod schemas + inferred types. The **single source of truth** for every shape that crosses the FE ⇄ BE ⇄ agent boundary: structured intents, tool I/O, and request/response DTOs. Read the root [`CLAUDE.md`](../../CLAUDE.md) first; this adds package-specific detail.

## Principle

Define a shape **once** here as a Zod schema, derive its type with `z.infer`, and import it everywhere. Never hand-write a parallel `interface` in `api/` or `web/` for something this package already describes. The schema is the runtime validator; the inferred type is the compile-time shape.

```
src/
├── common.ts          # shared enums/helpers (SupportedAsset, FiatCurrency, money, ids)
├── intents/           # structured-intent objects the NLU layer emits
├── tools/             # tool input/output contracts the agent + engine share
├── dto/               # request/response DTOs for the web app's endpoints
├── admin/             # admin-console DTOs (RBAC, settings, KYC review, tx oversight, …)
├── auth/              # auth DTOs (email-OTP/sessions) + PAT schemas (PatScope, mint/list/revoke)
├── beneficiaries/     # saved-recipient (bank + crypto) shapes
├── chat/              # web chat request/response + agent outcome cards
├── media/             # voice/document media contracts
├── transactions/      # transaction history/detail shapes
├── whatsapp/          # WhatsApp inbound payload schemas
└── index.ts           # barrel re-exporting all of the above
```

`package.json` `exports` expose the root (`.`) plus subpaths `./intents`, `./tools`, `./dto`, `./beneficiaries`, `./media`, `./admin`. The `auth/`, `chat/`, `transactions/`, and `whatsapp/` schemas are currently reachable through the root barrel only. **A new top-level schema directory must be added to both the `index.ts` barrel and the `exports` map** — a bare `@handshake-agent/contracts/<new>` import fails resolution otherwise.

## Source-only package — no build step

`exports` point straight at `src/*.ts`; the consuming apps transpile it. This keeps changes instant and avoids stale-`dist` drift. The trade-off is that **each consumer must be told how to resolve the raw TypeScript**:

- **web** (`next.config.ts`): `transpilePackages: ['@handshake-agent/contracts']`, plus a `tsconfig.json` path alias. Next 16 (ESM, `moduleResolution: bundler`) reads the source directly.
- **api** (`tsconfig.json`): a path alias to `../packages/contracts/src/*`. Nest's `tsc` build compiles the source into its CommonJS output.
- **api Jest**: ts-jest does **not** honor the `exports` map. Add a `moduleNameMapper` so the bare specifier resolves to the source, or tests throw `Cannot use import statement outside a module`. Mind the base: the api Jest `rootDir` is `src`, so the path is `../../packages/...` (two levels up from `api/src`), whereas the tsconfig alias above is relative to `api/` (one level up). They differ:

  ```js
  // in api/package.json "jest" block (rootDir is "src")
  moduleNameMapper: {
    '^@handshake-agent/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
    '^@handshake-agent/contracts/(.*)$': '<rootDir>/../../packages/contracts/src/$1',
  }
  ```

Only switch to a `tsup` build (dual ESM+CJS + `.d.ts`) if this package is ever published externally. For a private workspace, source-only wins.

## Rules

- **One `zod` instance for our code.** `zod` is a `peerDependency` here with floor `^3.25.32` (the LangGraph floor); the consuming apps (`api`, `web`, `web-admin`) currently declare `^3.25.76` — same major line, satisfies the peer range. Do **not** "correct" a consumer down to `^3.25.32`; what matters is that every workspace package resolves a **single** zod — two copies across the boundary cause silent `instanceof ZodType` failures (`zodResolver`/`createZodDto` break). Note: tooling deps (`eslint-plugin-react-hooks`, the `shadcn` CLI's MCP SDK) carry their own nested `zod@4` — that is isolated under their own trees and does not affect our schemas. **Do not add a global `pnpm.overrides` for zod** — it would clobber those tools' required version.
- **Decorator-free.** No `class-validator`/Nest decorators here — `web`'s bundler does not enable `experimentalDecorators`. Pure Zod only. `api` wraps schemas with `nestjs-zod`'s `createZodDto` on its side.
- **Types are erased at runtime.** Only schemas exist at runtime — always `.parse()`/`.safeParse()` at trust boundaries; the inferred type alone guarantees nothing over the wire.
- **Prefer subpath imports in `web`** (`@handshake-agent/contracts/dto`) so Next can tree-shake.
- **Explicit, additive enum growth.** Widen `SupportedAsset`/`FiatCurrency` etc. here as scope grows; never fork them.

## Consuming it

```ts
// api — turn a shared schema into a validated Nest DTO
import { createZodDto } from "nestjs-zod";
import { CreateBuyOrderRequestSchema } from "@handshake-agent/contracts/dto";
export class CreateBuyOrderDto extends createZodDto(
  CreateBuyOrderRequestSchema,
) {}

// web — react-hook-form + parse-before-send / parse-after-receive
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CreateBuyOrderRequestSchema,
  CreateBuyOrderResponseSchema,
} from "@handshake-agent/contracts";
const form = useForm({ resolver: zodResolver(CreateBuyOrderRequestSchema) });
const res = await api.post(
  "/buy/orders",
  CreateBuyOrderRequestSchema.parse(input),
);
return CreateBuyOrderResponseSchema.parse(res.data);
```

This package carries the full production contract surface (intents, tools, DTOs across all verticals plus the admin console). `buy-crypto.intent` / `quote-buy.tool` / `buy-order.dto` are the **reference pattern** — mirror their structure (schema + `z.infer` type + parse fixtures test) when adding a new capability.
