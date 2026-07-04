# System-health real provider connectivity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the non-settling providers (Resend, WhatsApp, Anthropic) on the operator System-health card show real, cached connectivity status + latency instead of a hardcoded `ok / —`.

**Architecture:** Extract a shared provider-probe registry + a pure posture resolver; add a singleton `CachedProviderConnectivityAdapter` (lazy 45s TTL cache + single-flight) behind a new `PROVIDER_CONNECTIVITY` port that wraps the existing `PROVIDER_PROBE`; overlay probe-derived status/latency onto the non-settling providers inside `MetricsOpsReadPrismaRepository.providerHealth()`, leaving the settling providers outbox-derived.

**Tech Stack:** NestJS 11, TypeScript 5.9 (write as if `strict`), Jest + `@nestjs/testing`, Prisma 7, Zod env schema. Spec: [`docs/superpowers/specs/2026-07-04-system-health-provider-connectivity-probe-design.md`](../specs/2026-07-04-system-health-provider-connectivity-probe-design.md).

## Global Constraints

- **§3.1** read-only; no LLM output and nothing here moves money. The probe is a credential-free GET.
- **§3.4/§3.5** no secret VALUE leaves the process — only a base URL crosses to the probe port.
- **§4.1 / dependency-cruiser** `application → infrastructure`/`@prisma/client` is forbidden; `infrastructure → application` (ports) is allowed and is the pattern used.
- **Contract is frozen:** `ProviderStatus` stays `ok | degraded | down`; `lastLatencyMs` stays nullable. No `packages/contracts` change, no frontend change.
- **LLM default model id** `claude-opus-4-8` (unchanged; only referenced in a provider `note`).
- **Single-instance zod** `^3.25.32`; import shared shapes from `@handshake-agent/contracts`, never redefine.
- **TDD:** every task is red → green → refactor; commit per task with a Conventional Commit (`feat(api): …` / `test(api): …`).
- **Single-file test run:** `pnpm --filter @handshake-agent/api exec jest <relative-path> -t "<name>"` (runs in `api/` where the inline jest config lives).
- **Branch:** work on `feat/system-health-provider-probe`; final delivery is a fast-forward push to `feat/platform-hardening` (PR #26).

---

## File Structure

**New**

- `api/src/modules/admin/application/provider-probe-registry.ts` — shared `ProbeSpec`, `PROVIDER_PROBE_SPECS` (5 providers, all with base URLs), pure `resolveProbePosture`.
- `api/src/modules/admin/application/provider-probe-registry.spec.ts`
- `api/src/modules/admin/application/ports/provider-connectivity.port.ts` — `PROVIDER_CONNECTIVITY` token + `IProviderConnectivity` + `ProviderConnectivity`.
- `api/src/modules/admin/infrastructure/cached-provider-connectivity.adapter.ts` — TTL cache + single-flight.
- `api/src/modules/admin/infrastructure/cached-provider-connectivity.adapter.spec.ts`
- `api/src/modules/admin/infrastructure/metrics-ops-read.prisma.repository.spec.ts` — new coverage for both derivation paths.

**Modify**

- `api/src/core/config/env.schema.ts` (+ `.spec.ts`) — `RESEND_BASE_URL`, `ANTHROPIC_BASE_URL`.
- `api/.env.example` — the two new keys.
- `api/src/modules/admin/application/admin-provider-probe.service.ts` (+ `.spec.ts`) — consume the shared registry.
- `api/src/modules/admin/infrastructure/metrics-ops-read.prisma.repository.ts` — inject `PROVIDER_CONNECTIVITY`, overlay non-settling providers, update docstring.
- `api/src/modules/admin/admin.module.ts` — bind `PROVIDER_CONNECTIVITY`.

---

## Task 1: New provider base-URL env keys

**Files:**

- Modify: `api/src/core/config/env.schema.ts`
- Modify: `api/.env.example`
- Test: `api/src/core/config/env.schema.spec.ts`

**Interfaces:**

- Produces: `Env['RESEND_BASE_URL']: string`, `Env['ANTHROPIC_BASE_URL']: string` (both default-valued).

- [ ] **Step 1: Write failing tests** — append inside `describe('validateEnv', …)` in `env.schema.spec.ts`:

```ts
it("defaults RESEND_BASE_URL to https://api.resend.com", () => {
  expect(validateEnv(validRaw).RESEND_BASE_URL).toBe("https://api.resend.com");
});

it("defaults ANTHROPIC_BASE_URL to https://api.anthropic.com", () => {
  expect(validateEnv(validRaw).ANTHROPIC_BASE_URL).toBe(
    "https://api.anthropic.com",
  );
});

it("throws when ANTHROPIC_BASE_URL is not a valid URL", () => {
  expect(() =>
    validateEnv({ ...validRaw, ANTHROPIC_BASE_URL: "nope" }),
  ).toThrow(/ANTHROPIC_BASE_URL/);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @handshake-agent/api exec jest src/core/config/env.schema.spec.ts -t "BASE_URL"`
Expected: FAIL (`RESEND_BASE_URL`/`ANTHROPIC_BASE_URL` are `undefined`).

- [ ] **Step 3: Add the keys.** In `env.schema.ts`, immediately after the `AGENT_MODEL` line (next to `ANTHROPIC_API_KEY`), add:

```ts
    // Public API host for the Anthropic liveness probe (system-health card). Non-secret;
    // mirrors WHATSAPP_GRAPH_BASE_URL / BLOCKRADAR_BASE_URL. Only the host is probed — no key.
    ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
```

And immediately after the `RESEND_API_KEY` block, add:

```ts
    // Public API host for the Resend liveness probe (system-health card). Non-secret.
    RESEND_BASE_URL: z.string().url().default('https://api.resend.com'),
```

- [ ] **Step 4: Mirror in `.env.example`.** Add under the relevant sections:

```
# Public API host probed for the system-health card (non-secret; safe defaults).
ANTHROPIC_BASE_URL=https://api.anthropic.com
RESEND_BASE_URL=https://api.resend.com
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @handshake-agent/api exec jest src/core/config/env.schema.spec.ts`
Expected: PASS (all env specs green).

- [ ] **Step 6: Commit**

```bash
git add api/src/core/config/env.schema.ts api/src/core/config/env.schema.spec.ts api/.env.example
git commit -m "feat(api): add RESEND_BASE_URL/ANTHROPIC_BASE_URL for provider liveness probe"
```

---

## Task 2: Shared provider-probe registry + posture resolver

**Files:**

- Create: `api/src/modules/admin/application/provider-probe-registry.ts`
- Test: `api/src/modules/admin/application/provider-probe-registry.spec.ts`

**Interfaces:**

- Consumes: `Env` (`../../../core/config/env.schema`).
- Produces:
  - `interface ProbeSpec { key: string; secretKey: keyof Env; mockModeKey: keyof Env | null; baseUrlKey: keyof Env | null }`
  - `const PROVIDER_PROBE_SPECS: readonly ProbeSpec[]`
  - `type ProbeConfigReader = (key: keyof Env) => string | number | undefined`
  - `type ProbePosture = { kind: 'mock' } | { kind: 'not_configured' } | { kind: 'probe'; baseUrl: string }`
  - `function resolveProbePosture(spec: ProbeSpec, read: ProbeConfigReader): ProbePosture`

- [ ] **Step 1: Write the failing test** — `provider-probe-registry.spec.ts`:

```ts
import {
  PROVIDER_PROBE_SPECS,
  resolveProbePosture,
  type ProbeConfigReader,
  type ProbeSpec,
} from "./provider-probe-registry";
import type { Env } from "../../../core/config/env.schema";

function readerFrom(env: Partial<Env>): ProbeConfigReader {
  return (key) => env[key] as string | number | undefined;
}

function spec(key: string): ProbeSpec {
  const found = PROVIDER_PROBE_SPECS.find((s) => s.key === key);
  if (found === undefined) throw new Error(`no spec for ${key}`);
  return found;
}

const LIVE: Partial<Env> = {
  BLOCKRADAR_API_KEY: "br",
  BLOCKRADAR_BASE_URL: "https://api.blockradar.co/v1",
  RESEND_API_KEY: "re",
  RESEND_BASE_URL: "https://api.resend.com",
  WHATSAPP_ACCESS_TOKEN: "wa",
  WHATSAPP_GRAPH_BASE_URL: "https://graph.facebook.com",
  ANTHROPIC_API_KEY: "ant",
  ANTHROPIC_BASE_URL: "https://api.anthropic.com",
  WALLET_MOCK_MODE: "false",
  PAYMENTS_MOCK_MODE: "false",
};

describe("resolveProbePosture", () => {
  it("registers all five providers with a base URL each", () => {
    expect(PROVIDER_PROBE_SPECS.map((s) => s.key)).toEqual([
      "blockradar",
      "flutterwave",
      "resend",
      "whatsapp",
      "anthropic",
    ]);
    for (const s of PROVIDER_PROBE_SPECS) expect(s.baseUrlKey).not.toBeNull();
  });

  it("returns a probe posture with the resolved base URL when live (non-settling)", () => {
    expect(resolveProbePosture(spec("anthropic"), readerFrom(LIVE))).toEqual({
      kind: "probe",
      baseUrl: "https://api.anthropic.com",
    });
  });

  it('returns mock when the adapter mock-mode flag is "true" (settling)', () => {
    const reader = readerFrom({ ...LIVE, WALLET_MOCK_MODE: "true" });
    expect(resolveProbePosture(spec("blockradar"), reader)).toEqual({
      kind: "mock",
    });
  });

  it("returns not_configured when the secret is absent", () => {
    const reader = readerFrom({ ...LIVE, ANTHROPIC_API_KEY: undefined });
    expect(resolveProbePosture(spec("anthropic"), reader)).toEqual({
      kind: "not_configured",
    });
  });

  it("returns not_configured when the base URL is absent/empty", () => {
    const reader = readerFrom({ ...LIVE, RESEND_BASE_URL: "" });
    expect(resolveProbePosture(spec("resend"), reader)).toEqual({
      kind: "not_configured",
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @handshake-agent/api exec jest src/modules/admin/application/provider-probe-registry.spec.ts`
Expected: FAIL (`Cannot find module './provider-probe-registry'`).

- [ ] **Step 3: Implement `provider-probe-registry.ts`:**

```ts
import type { Env } from "../../../core/config/env.schema";

/**
 * Shared PROVIDER LIVENESS-PROBE registry (Phase 7 "Test connection" + the Phase-6b
 * system-health card). Each entry names the env keys that resolve a provider's probe
 * posture: the secret whose presence marks it configured, the `*_MOCK_MODE` gate (or
 * null), and the public API base host to reach credential-free. NO secret VALUE ever
 * leaves via this module — only the base URL is surfaced (§3.4/§3.5). Pure data + a
 * pure resolver, so both the on-demand probe service and the cached connectivity
 * adapter derive posture identically (DRY §13.2).
 */
export interface ProbeSpec {
  key: string;
  /** Env key whose presence marks the provider's secret as configured. */
  secretKey: keyof Env;
  /** `*_MOCK_MODE` env key gating this adapter, or null if it has none. */
  mockModeKey: keyof Env | null;
  /** Env key holding the provider's public API base host. */
  baseUrlKey: keyof Env | null;
}

export const PROVIDER_PROBE_SPECS: readonly ProbeSpec[] = [
  {
    key: "blockradar",
    secretKey: "BLOCKRADAR_API_KEY",
    mockModeKey: "WALLET_MOCK_MODE",
    baseUrlKey: "BLOCKRADAR_BASE_URL",
  },
  {
    key: "flutterwave",
    secretKey: "FLUTTERWAVE_SECRET_KEY",
    mockModeKey: "PAYMENTS_MOCK_MODE",
    baseUrlKey: "FLUTTERWAVE_BASE_URL",
  },
  {
    key: "resend",
    secretKey: "RESEND_API_KEY",
    mockModeKey: null,
    baseUrlKey: "RESEND_BASE_URL",
  },
  {
    key: "whatsapp",
    secretKey: "WHATSAPP_ACCESS_TOKEN",
    mockModeKey: null,
    baseUrlKey: "WHATSAPP_GRAPH_BASE_URL",
  },
  {
    key: "anthropic",
    secretKey: "ANTHROPIC_API_KEY",
    mockModeKey: null,
    baseUrlKey: "ANTHROPIC_BASE_URL",
  },
];

/** Reads a config value by env key. Loose value type — the resolver only needs
 *  presence + string coercion, and this keeps callers free of ConfigService generics. */
export type ProbeConfigReader = (key: keyof Env) => string | number | undefined;

/** The resolved probe posture for one provider. */
export type ProbePosture =
  | { kind: "mock" }
  | { kind: "not_configured" }
  | { kind: "probe"; baseUrl: string };

/**
 * Fail-closed posture resolution (identical rules for both consumers):
 *   mock-mode 'true'            → mock (no probe attempted)
 *   secret absent OR no base URL→ not_configured (never probe with no host)
 *   otherwise                   → probe against the resolved base host.
 */
export function resolveProbePosture(
  spec: ProbeSpec,
  read: ProbeConfigReader,
): ProbePosture {
  if (spec.mockModeKey !== null && read(spec.mockModeKey) === "true") {
    return { kind: "mock" };
  }
  const hasSecret = Boolean(read(spec.secretKey));
  const rawBaseUrl =
    spec.baseUrlKey !== null ? read(spec.baseUrlKey) : undefined;
  const baseUrl = rawBaseUrl === undefined ? undefined : String(rawBaseUrl);
  if (!hasSecret || baseUrl === undefined || baseUrl.length === 0) {
    return { kind: "not_configured" };
  }
  return { kind: "probe", baseUrl };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @handshake-agent/api exec jest src/modules/admin/application/provider-probe-registry.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/application/provider-probe-registry.ts api/src/modules/admin/application/provider-probe-registry.spec.ts
git commit -m "feat(api): shared provider-probe registry + pure posture resolver"
```

---

## Task 3: Refactor AdminProviderProbeService onto the shared registry

**Files:**

- Modify: `api/src/modules/admin/application/admin-provider-probe.service.ts`
- Test: `api/src/modules/admin/application/admin-provider-probe.service.spec.ts`

**Interfaces:**

- Consumes: `PROVIDER_PROBE_SPECS`, `resolveProbePosture` (Task 2); unchanged `IProviderProbe`, `ProviderTestResponse`.
- Produces: `AdminProviderProbeService.test(key)` — same signature; Resend/WhatsApp/Anthropic now probe when configured.

- [ ] **Step 1: Update the spec (red first).** In `admin-provider-probe.service.spec.ts`, extend `LIVE_ENV` with the base URLs and replace the "no probe endpoint" test:

```ts
const LIVE_ENV: Partial<Env> = {
  BLOCKRADAR_API_KEY: "br-key",
  BLOCKRADAR_BASE_URL: "https://api.blockradar.co/v1",
  FLUTTERWAVE_SECRET_KEY: "flw-key",
  FLUTTERWAVE_BASE_URL: "https://api.flutterwave.com/v3",
  RESEND_API_KEY: "re-key",
  RESEND_BASE_URL: "https://api.resend.com",
  WHATSAPP_ACCESS_TOKEN: "wa-token",
  WHATSAPP_GRAPH_BASE_URL: "https://graph.facebook.com",
  ANTHROPIC_API_KEY: "ant-key",
  ANTHROPIC_BASE_URL: "https://api.anthropic.com",
  WALLET_MOCK_MODE: "false",
  PAYMENTS_MOCK_MODE: "false",
};
```

Replace the final test (`treats a provider with no probe endpoint … as not_configured`) with:

```ts
it("now probes anthropic against its configured base URL (secret present)", async () => {
  const res = await build(LIVE_ENV).test("anthropic");
  expect(probe.probe).toHaveBeenCalledWith("https://api.anthropic.com");
  expect(res.result).toBe("ok");
  expect(res.latencyMs).toBe(120);
});

it("is not_configured for anthropic when its secret is absent", async () => {
  const res = await build({ ...LIVE_ENV, ANTHROPIC_API_KEY: undefined }).test(
    "anthropic",
  );
  expect(probe.probe).not.toHaveBeenCalled();
  expect(res.result).toBe("not_configured");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @handshake-agent/api exec jest src/modules/admin/application/admin-provider-probe.service.spec.ts`
Expected: FAIL (old code returns `not_configured` for anthropic because its local `PROBE_SPECS` has `baseUrlKey: null`).

- [ ] **Step 3: Refactor the service.** Replace the local `ProbeSpec` interface + `PROBE_SPECS` array + the posture branches in `test()` with the shared registry. New file body (imports at top, keep `RESULT_BY_REACHABILITY`, drop `isMock`):

```ts
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type {
  ProviderProbeResult,
  ProviderTestResponse,
} from "@handshake-agent/contracts";

import type { Env } from "../../../core/config/env.schema";
import { AdminNotFoundError } from "../domain/admin-errors";
import {
  PROVIDER_PROBE,
  type IProviderProbe,
  type ProviderReachability,
} from "./ports/provider-probe.port";
import {
  PROVIDER_PROBE_SPECS,
  resolveProbePosture,
} from "./provider-probe-registry";

/** Reachability outcome → the wire probe-result word. */
const RESULT_BY_REACHABILITY: Record<
  ProviderReachability,
  ProviderProbeResult
> = {
  ok: "ok",
  degraded: "degraded",
  down: "down",
};

@Injectable()
export class AdminProviderProbeService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(PROVIDER_PROBE) private readonly probe: IProviderProbe,
  ) {}

  /** Run a liveness probe for one provider key (fail-closed on unknown key). */
  async test(key: string): Promise<ProviderTestResponse> {
    const spec = PROVIDER_PROBE_SPECS.find((s) => s.key === key);
    if (spec === undefined) throw new AdminNotFoundError("Provider");

    const checkedAt = new Date().toISOString();
    const posture = resolveProbePosture(spec, (k) =>
      this.config.get(k, { infer: true }),
    );

    if (posture.kind === "mock") {
      return { key, result: "mock", latencyMs: null, checkedAt };
    }
    if (posture.kind === "not_configured") {
      return { key, result: "not_configured", latencyMs: null, checkedAt };
    }

    const outcome = await this.probe.probe(posture.baseUrl);
    const result = RESULT_BY_REACHABILITY[outcome.reachability];
    const latencyMs =
      outcome.reachability === "down" ? null : outcome.latencyMs;
    return { key, result, latencyMs, checkedAt };
  }
}
```

Keep the file's leading doc-comment block; drop the now-unused `ProbeSpec` interface, `PROBE_SPECS` const, and `isMock` method.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @handshake-agent/api exec jest src/modules/admin/application/admin-provider-probe.service.spec.ts`
Expected: PASS (all cases, including the two new ones). If the `config.get(k, { infer: true })` accessor trips `no-unnecessary-type-assertion` or a union-type error, coerce with `as string | number | undefined` and a one-line comment.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/application/admin-provider-probe.service.ts api/src/modules/admin/application/admin-provider-probe.service.spec.ts
git commit -m "refactor(api): probe service uses shared registry; probes resend/whatsapp/anthropic"
```

---

## Task 4: PROVIDER_CONNECTIVITY port

**Files:**

- Create: `api/src/modules/admin/application/ports/provider-connectivity.port.ts`

**Interfaces:**

- Produces: `PROVIDER_CONNECTIVITY` symbol; `ProviderConnectivity { status: 'ok'|'degraded'|'down'; latencyMs: number|null; observed: boolean }`; `IProviderConnectivity { statusFor(key: string): Promise<ProviderConnectivity | null> }`.

- [ ] **Step 1: Create the port** (no separate test — it's a type + token, exercised by Tasks 5 & 6):

```ts
/**
 * DI token + port for CACHED PROVIDER CONNECTIVITY — a short-TTL liveness view used
 * by the operator system-health card. It reports each provider's most-recent
 * reachability + latency from a cached snapshot (never a synchronous per-request
 * probe). Read-only, credential-free (§3.1/§3.4/§3.5). The concrete cache/probe
 * adapter lives in `admin/infrastructure`; the metrics-ops read repository depends
 * only on this abstraction.
 */
export const PROVIDER_CONNECTIVITY = Symbol("PROVIDER_CONNECTIVITY");

/** A provider's cached liveness signal. */
export interface ProviderConnectivity {
  status: "ok" | "degraded" | "down";
  /** Observed round-trip latency (ms); null for `down` or when unobserved. */
  latencyMs: number | null;
  /**
   * true  → a real observed probe result (use status + latency).
   * false → mock / not-configured / no host — NOT a live signal; the caller should
   *         keep its own placeholder rather than surface a fabricated status.
   */
  observed: boolean;
}

export interface IProviderConnectivity {
  /**
   * Cached liveness for a provider key (short TTL, single-flight refresh). Returns
   * null when the key is unknown to the probe registry. NEVER throws.
   */
  statusFor(key: string): Promise<ProviderConnectivity | null>;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @handshake-agent/api exec tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/admin/application/ports/provider-connectivity.port.ts
git commit -m "feat(api): PROVIDER_CONNECTIVITY port for cached provider liveness"
```

---

## Task 5: CachedProviderConnectivityAdapter (TTL cache + single-flight)

**Files:**

- Create: `api/src/modules/admin/infrastructure/cached-provider-connectivity.adapter.ts`
- Test: `api/src/modules/admin/infrastructure/cached-provider-connectivity.adapter.spec.ts`

**Interfaces:**

- Consumes: `IProviderProbe` (`PROVIDER_PROBE`), `ConfigService<Env,true>`, `Clock` (`CLOCK`), `PROVIDER_PROBE_SPECS`, `resolveProbePosture`.
- Produces: `class CachedProviderConnectivityAdapter implements IProviderConnectivity`.

- [ ] **Step 1: Write the failing test** — `cached-provider-connectivity.adapter.spec.ts`:

```ts
import { CachedProviderConnectivityAdapter } from "./cached-provider-connectivity.adapter";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../../core/config/env.schema";
import type { Clock } from "../../../core/common/clock";
import type { IProviderProbe } from "../application/ports/provider-probe.port";

const LIVE_ENV: Partial<Env> = {
  BLOCKRADAR_API_KEY: "br",
  BLOCKRADAR_BASE_URL: "https://api.blockradar.co/v1",
  FLUTTERWAVE_SECRET_KEY: "flw",
  FLUTTERWAVE_BASE_URL: "https://api.flutterwave.com/v3",
  RESEND_API_KEY: "re",
  RESEND_BASE_URL: "https://api.resend.com",
  WHATSAPP_ACCESS_TOKEN: "wa",
  WHATSAPP_GRAPH_BASE_URL: "https://graph.facebook.com",
  ANTHROPIC_API_KEY: "ant",
  ANTHROPIC_BASE_URL: "https://api.anthropic.com",
  WALLET_MOCK_MODE: "false",
  PAYMENTS_MOCK_MODE: "false",
};

function makeConfig(env: Partial<Env>): ConfigService<Env, true> {
  return { get: (k: keyof Env) => env[k] } as unknown as ConfigService<
    Env,
    true
  >;
}
function makeProbe(): jest.Mocked<IProviderProbe> {
  return {
    probe: jest.fn().mockResolvedValue({ reachability: "ok", latencyMs: 120 }),
  };
}
function makeClock(startMs: number): {
  clock: Clock;
  set: (ms: number) => void;
} {
  let nowMs = startMs;
  return {
    clock: { now: () => new Date(nowMs) },
    set: (ms) => {
      nowMs = ms;
    },
  };
}

describe("CachedProviderConnectivityAdapter", () => {
  it("returns an observed status + latency for a probeable provider", async () => {
    const probe = makeProbe();
    const a = new CachedProviderConnectivityAdapter(
      makeConfig(LIVE_ENV),
      probe,
      makeClock(0).clock,
    );
    const res = await a.statusFor("resend");
    expect(res).toEqual({ status: "ok", latencyMs: 120, observed: true });
    // credential-free: probe called with the base URL only, never a secret value
    const arg = probe.probe.mock.calls[0][0] as string;
    expect(arg).toBe("https://api.resend.com");
    expect(arg).not.toContain("re");
  });

  it("maps a down reachability to null latency, still observed", async () => {
    const probe = makeProbe();
    probe.probe.mockResolvedValue({ reachability: "down", latencyMs: 4000 });
    const a = new CachedProviderConnectivityAdapter(
      makeConfig(LIVE_ENV),
      probe,
      makeClock(0).clock,
    );
    expect(await a.statusFor("whatsapp")).toEqual({
      status: "down",
      latencyMs: null,
      observed: true,
    });
  });

  it("is unobserved (no probe) when a provider is not_configured", async () => {
    const probe = makeProbe();
    const env = { ...LIVE_ENV, ANTHROPIC_API_KEY: undefined };
    const a = new CachedProviderConnectivityAdapter(
      makeConfig(env),
      probe,
      makeClock(0).clock,
    );
    const res = await a.statusFor("anthropic");
    expect(res).toEqual({ status: "ok", latencyMs: null, observed: false });
    // anthropic was skipped; only the other four (configured) providers were probed
    const probedUrls = probe.probe.mock.calls.map((c) => c[0]);
    expect(probedUrls).not.toContain("https://api.anthropic.com");
  });

  it("is unobserved (no probe) when a settling adapter is in mock mode", async () => {
    const probe = makeProbe();
    const a = new CachedProviderConnectivityAdapter(
      makeConfig({ ...LIVE_ENV, WALLET_MOCK_MODE: "true" }),
      probe,
      makeClock(0).clock,
    );
    expect(await a.statusFor("blockradar")).toEqual({
      status: "ok",
      latencyMs: null,
      observed: false,
    });
  });

  it("single-flights: concurrent calls trigger exactly one probe per provider", async () => {
    const probe = makeProbe();
    const a = new CachedProviderConnectivityAdapter(
      makeConfig(LIVE_ENV),
      probe,
      makeClock(0).clock,
    );
    await Promise.all([
      a.statusFor("resend"),
      a.statusFor("whatsapp"),
      a.statusFor("anthropic"),
    ]);
    // 5 providers, each probed once — not once-per-caller
    expect(probe.probe).toHaveBeenCalledTimes(5);
  });

  it("serves the cache within the TTL and re-probes after it expires", async () => {
    const probe = makeProbe();
    const c = makeClock(0);
    const a = new CachedProviderConnectivityAdapter(
      makeConfig(LIVE_ENV),
      probe,
      c.clock,
    );

    await a.statusFor("resend");
    expect(probe.probe).toHaveBeenCalledTimes(5);

    c.set(44_000); // < 45s TTL → cache hit, no new probes
    await a.statusFor("resend");
    expect(probe.probe).toHaveBeenCalledTimes(5);

    c.set(46_000); // > TTL → refresh
    await a.statusFor("resend");
    expect(probe.probe).toHaveBeenCalledTimes(10);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @handshake-agent/api exec jest src/modules/admin/infrastructure/cached-provider-connectivity.adapter.spec.ts`
Expected: FAIL (`Cannot find module './cached-provider-connectivity.adapter'`).

- [ ] **Step 3: Implement the adapter:**

```ts
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { CLOCK, type Clock } from "../../../core/common/clock";
import type { Env } from "../../../core/config/env.schema";
import {
  PROVIDER_PROBE,
  type IProviderProbe,
} from "../application/ports/provider-probe.port";
import type {
  IProviderConnectivity,
  ProviderConnectivity,
} from "../application/ports/provider-connectivity.port";
import {
  PROVIDER_PROBE_SPECS,
  resolveProbePosture,
  type ProbeSpec,
} from "../application/provider-probe-registry";

/**
 * Cached provider-connectivity adapter for the system-health card. Runs a real,
 * CREDENTIAL-FREE liveness probe (via PROVIDER_PROBE) against each provider's public
 * host and caches the whole snapshot for a short TTL, refreshed at most once per
 * window (single-flight). A synchronous per-request probe is deliberately avoided
 * (§design): reads inside the TTL are served from memory. Read-only, moves no money
 * (§3.1); no secret VALUE crosses the boundary (§3.4/§3.5). Singleton scope so the
 * cache persists across requests. Never throws (the probe port never throws).
 *
 * SNAPSHOT_TTL_MS is a documented internal constant, consistent with the existing
 * hardcoded PROBE_TIMEOUT_MS / DEGRADED_LATENCY_MS in the probe adapter.
 */
const SNAPSHOT_TTL_MS = 45_000;

@Injectable()
export class CachedProviderConnectivityAdapter implements IProviderConnectivity {
  private snapshot: Map<string, ProviderConnectivity> | null = null;
  private snapshotAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Inject(PROVIDER_PROBE) private readonly probe: IProviderProbe,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async statusFor(key: string): Promise<ProviderConnectivity | null> {
    await this.ensureFresh();
    return this.snapshot?.get(key) ?? null;
  }

  /** Refresh the snapshot if stale/cold; concurrent callers await one in-flight run. */
  private async ensureFresh(): Promise<void> {
    const isFresh =
      this.snapshot !== null &&
      this.clock.now().getTime() - this.snapshotAt < SNAPSHOT_TTL_MS;
    if (isFresh) return;

    if (this.inflight !== null) {
      await this.inflight;
      return;
    }
    this.inflight = this.refresh().finally(() => {
      this.inflight = null;
    });
    await this.inflight;
  }

  private async refresh(): Promise<void> {
    const entries = await Promise.all(
      PROVIDER_PROBE_SPECS.map(
        async (spec) => [spec.key, await this.probeOne(spec)] as const,
      ),
    );
    this.snapshot = new Map(entries);
    this.snapshotAt = this.clock.now().getTime();
  }

  private async probeOne(spec: ProbeSpec): Promise<ProviderConnectivity> {
    const posture = resolveProbePosture(spec, (k) =>
      this.config.get(k, { infer: true }),
    );
    if (posture.kind !== "probe") {
      // mock / not_configured → no live signal; caller keeps its placeholder.
      return { status: "ok", latencyMs: null, observed: false };
    }
    const outcome = await this.probe.probe(posture.baseUrl);
    return {
      status: outcome.reachability,
      latencyMs: outcome.reachability === "down" ? null : outcome.latencyMs,
      observed: true,
    };
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @handshake-agent/api exec jest src/modules/admin/infrastructure/cached-provider-connectivity.adapter.spec.ts`
Expected: PASS (all six cases).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/infrastructure/cached-provider-connectivity.adapter.ts api/src/modules/admin/infrastructure/cached-provider-connectivity.adapter.spec.ts
git commit -m "feat(api): cached provider-connectivity adapter (45s TTL + single-flight)"
```

---

## Task 6: Overlay probe-derived health onto non-settling providers

**Files:**

- Modify: `api/src/modules/admin/infrastructure/metrics-ops-read.prisma.repository.ts`
- Test: `api/src/modules/admin/infrastructure/metrics-ops-read.prisma.repository.spec.ts` (new)

**Interfaces:**

- Consumes: `PROVIDER_CONNECTIVITY` / `IProviderConnectivity` (Task 4); unchanged `PrismaService`.
- Produces: `MetricsOpsReadPrismaRepository` constructor is now `(prisma, connectivity)`; `systemHealth()` unchanged shape.

- [ ] **Step 1: Write the failing test** — `metrics-ops-read.prisma.repository.spec.ts`:

```ts
import { MetricsOpsReadPrismaRepository } from "./metrics-ops-read.prisma.repository";
import type { PrismaService } from "../../../core/prisma/prisma.service";
import type { IProviderConnectivity } from "../application/ports/provider-connectivity.port";

/** A completed outbox row → statusOf() 'ok', latencyOf() 150ms. */
const completedRow = {
  status: "completed",
  createdAt: new Date("2026-07-04T00:00:00.000Z"),
  lastAttemptAt: null,
  completedAt: new Date("2026-07-04T00:00:00.150Z"),
};

function makePrisma(): PrismaService {
  return {
    settlementOutbox: {
      findMany: jest.fn().mockResolvedValue([completedRow]),
      count: jest.fn().mockResolvedValue(3),
    },
    compensationRecord: { count: jest.fn().mockResolvedValue(2) },
  } as unknown as PrismaService;
}

function makeConnectivity(): jest.Mocked<IProviderConnectivity> {
  return {
    statusFor: jest.fn(async (key: string) => {
      if (key === "resend")
        return { status: "degraded" as const, latencyMs: 900, observed: true };
      if (key === "whatsapp")
        return { status: "down" as const, latencyMs: null, observed: true };
      if (key === "anthropic")
        return { status: "ok" as const, latencyMs: null, observed: false };
      return null;
    }),
  };
}

describe("MetricsOpsReadPrismaRepository.systemHealth", () => {
  it("derives settling providers from the outbox and never consults connectivity for them", async () => {
    const connectivity = makeConnectivity();
    const repo = new MetricsOpsReadPrismaRepository(makePrisma(), connectivity);

    const { providers } = await repo.systemHealth();
    const byKey = Object.fromEntries(providers.map((p) => [p.key, p]));

    expect(byKey.blockradar).toMatchObject({
      status: "ok",
      lastLatencyMs: 150,
    });
    expect(byKey.flutterwave).toMatchObject({
      status: "ok",
      lastLatencyMs: 150,
    });
    const consulted = connectivity.statusFor.mock.calls.map((c) => c[0]);
    expect(consulted).not.toContain("blockradar");
    expect(consulted).not.toContain("flutterwave");
  });

  it("overlays observed probe status + latency onto non-settling providers", async () => {
    const repo = new MetricsOpsReadPrismaRepository(
      makePrisma(),
      makeConnectivity(),
    );
    const { providers } = await repo.systemHealth();
    const byKey = Object.fromEntries(providers.map((p) => [p.key, p]));

    expect(byKey.resend).toMatchObject({
      status: "degraded",
      lastLatencyMs: 900,
    });
    expect(byKey.whatsapp).toMatchObject({
      status: "down",
      lastLatencyMs: null,
    });
  });

  it("keeps the ok/null placeholder when a non-settling provider is unobserved", async () => {
    const repo = new MetricsOpsReadPrismaRepository(
      makePrisma(),
      makeConnectivity(),
    );
    const { providers } = await repo.systemHealth();
    const anthropic = providers.find((p) => p.key === "anthropic");

    expect(anthropic).toMatchObject({ status: "ok", lastLatencyMs: null });
  });

  it("reports the pending queue depth and recon drift from counts", async () => {
    const repo = new MetricsOpsReadPrismaRepository(
      makePrisma(),
      makeConnectivity(),
    );
    const health = await repo.systemHealth();
    expect(health.webhookQueueDepth).toBe(3);
    expect(health.reconDriftCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @handshake-agent/api exec jest src/modules/admin/infrastructure/metrics-ops-read.prisma.repository.spec.ts`
Expected: FAIL (constructor currently takes one arg; TS/`toMatchObject` mismatch — anthropic would be `ok/null` by accident but resend/whatsapp overlay is missing → assertion fails).

- [ ] **Step 3: Modify the repository.** In `metrics-ops-read.prisma.repository.ts`:

Change the import line `import { Injectable } from '@nestjs/common';` to:

```ts
import { Inject, Injectable } from "@nestjs/common";
```

Add after the existing port import block:

```ts
import {
  PROVIDER_CONNECTIVITY,
  type IProviderConnectivity,
} from "../application/ports/provider-connectivity.port";
```

Replace the constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROVIDER_CONNECTIVITY)
    private readonly connectivity: IProviderConnectivity,
  ) {}
```

Replace the `settlementTypes.length === 0` branch inside `providerHealth()`:

```ts
if (provider.settlementTypes.length === 0) {
  // No settlement source — derive liveness from the cached connectivity
  // probe. An unobserved result (mock / not-configured / no host) keeps the
  // ok/null placeholder rather than surface a fabricated status.
  const c = await this.connectivity.statusFor(provider.key);
  if (c !== null && c.observed) {
    return {
      key: provider.key,
      name: provider.name,
      note: provider.note,
      status: c.status,
      lastLatencyMs: c.latencyMs,
    };
  }
  return {
    key: provider.key,
    name: provider.name,
    note: provider.note,
    status: "ok" as const,
    lastLatencyMs: null,
  };
}
```

Update the file's top `SYSTEM HEALTH (how it is derived)` doc block: change the "There is no synthetic provider probe … Providers with no settlement source (Resend/WhatsApp/Anthropic) report `ok` / latency null" sentence to describe the two paths — settling providers are outbox-derived; non-settling providers derive from a short-TTL cached liveness probe (`PROVIDER_CONNECTIVITY`), falling back to `ok`/null only when unobserved.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @handshake-agent/api exec jest src/modules/admin/infrastructure/metrics-ops-read.prisma.repository.spec.ts`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/infrastructure/metrics-ops-read.prisma.repository.ts api/src/modules/admin/infrastructure/metrics-ops-read.prisma.repository.spec.ts
git commit -m "feat(api): overlay cached connectivity onto non-settling providers in system health"
```

---

## Task 7: Wire PROVIDER_CONNECTIVITY into the admin module

**Files:**

- Modify: `api/src/modules/admin/admin.module.ts`

**Interfaces:**

- Consumes: `CachedProviderConnectivityAdapter` (Task 5), `PROVIDER_CONNECTIVITY` (Task 4). `MetricsOpsReadPrismaRepository` (Task 6) resolves the new dependency via DI.

- [ ] **Step 1: Confirm `CLOCK` is globally provided.**

Run: `git grep -n "provide: CLOCK" api/src`
Expected: a global binding (e.g. in a core/common module marked `@Global`). If it is NOT global, add `{ provide: CLOCK, useClass: SystemClock }` to `admin.module.ts` providers alongside the connectivity binding (import from `../../core/common/clock`).

- [ ] **Step 2: Add the imports** near the existing probe imports (around the `PROVIDER_PROBE` / `MetricsOpsReadPrismaRepository` import lines):

```ts
import { PROVIDER_CONNECTIVITY } from "./application/ports/provider-connectivity.port";
import { CachedProviderConnectivityAdapter } from "./infrastructure/cached-provider-connectivity.adapter";
```

- [ ] **Step 3: Add the provider binding.** Immediately after the `{ provide: PROVIDER_PROBE, useClass: HttpProviderProbeAdapter },` line in the `providers` array:

```ts
    // System-health card: cached, credential-free provider LIVENESS view (45s TTL +
    // single-flight) behind PROVIDER_CONNECTIVITY. Wraps the PROVIDER_PROBE adapter
    // (bound above) + ConfigService + CLOCK; feeds MetricsOpsReadPrismaRepository's
    // non-settling providers. Read-only, no secret leaves the boundary (§3.1/§3.4).
    { provide: PROVIDER_CONNECTIVITY, useClass: CachedProviderConnectivityAdapter },
```

- [ ] **Step 4: Typecheck + boot-shape check**

Run: `pnpm --filter @handshake-agent/api exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Run the admin unit suite** (fast confidence the module graph resolves for the touched services):

Run: `pnpm --filter @handshake-agent/api exec jest src/modules/admin`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/admin/admin.module.ts
git commit -m "feat(api): bind PROVIDER_CONNECTIVITY (cached liveness) in admin module"
```

---

## Task 8: Full gate run + boot e2e sanity

**Files:** none (verification).

- [ ] **Step 1: Depcruise (clean-arch boundaries)**

Run: `pnpm depcruise`
Expected: 0 errors. (Confirms `application → infrastructure` not violated; the infra repo depending on the application port is allowed.)

- [ ] **Step 2: Lint the touched files** (bare eslint, no `--fix`, per repo memory):

Run: `pnpm --filter @handshake-agent/api exec eslint src/modules/admin/application/provider-probe-registry.ts src/modules/admin/application/admin-provider-probe.service.ts src/modules/admin/application/ports/provider-connectivity.port.ts src/modules/admin/infrastructure/cached-provider-connectivity.adapter.ts src/modules/admin/infrastructure/metrics-ops-read.prisma.repository.ts src/modules/admin/admin.module.ts src/core/config/env.schema.ts`
Expected: 0 errors/warnings.

- [ ] **Step 3: Typecheck the api package**

Run: `pnpm --filter @handshake-agent/api exec tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 4: Full api unit suite**

Run: `pnpm --filter @handshake-agent/api test`
Expected: green (note any pre-existing red from the go-readiness memory — send-vertical velocity + admin-end-users tier — and confirm they are unrelated to these files).

- [ ] **Step 5: Metrics-ops e2e** (boot + read path still parses through the contract)

Run: `pnpm --filter @handshake-agent/api exec jest --config test/jest-e2e.json --testPathPattern "metrics-ops|admin-ops" -i`
Expected: PASS if such an e2e exists; if none matches, skip (the unit specs + module boot in Task 7 cover the graph).

- [ ] **Step 6: Final commit if any lint/format touched files**

```bash
git status --porcelain
# commit only if the gates modified files:
git commit -am "chore(api): lint/format after connectivity-probe wiring" || true
```

---

## Self-Review notes (author)

- **Spec coverage:** §5.1 → T2; §5.2 → T1; §5.3 → T3; §5.4 → T4; §5.5 → T5; §5.6 → T6; §5.7 → T7; §8 tests → T1–T6; §7 invariants → asserted in T5 (secret-free) + verified in T8 (depcruise). No frontend/contract task (spec §2 non-goal — confirmed).
- **Type consistency:** `resolveProbePosture(spec, read)` signature identical in T2/T3/T5; `ProviderConnectivity { status, latencyMs, observed }` identical in T4/T5/T6; repo constructor `(prisma, connectivity)` in T6 matches the `new …(makePrisma(), makeConnectivity())` in its spec.
- **Placeholder scan:** all code/test steps carry runnable code; the only conditional is T7-S1 (add a local `CLOCK` bind _iff_ not global) and the T3-S4 cast fallback — both fully specified.
