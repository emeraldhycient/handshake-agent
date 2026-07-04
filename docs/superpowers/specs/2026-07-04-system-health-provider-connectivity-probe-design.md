# System-health real provider connectivity (go-readiness #13)

**Date:** 2026-07-04
**Branch:** `feat/system-health-provider-probe` (off `feat/admin-integration-reads`)
**Status:** Approved design — ready for implementation plan.

---

## 1. Problem

The operator dashboard's **System-health card** ([`operator-dashboard.tsx`](../../../web-admin/components/admin/operator-dashboard.tsx) `SystemHealthCard`) and the **/providers ops-page tiles** ([`ops-page.tsx`](../../../web-admin/components/admin/ops-page.tsx) `ProviderTiles`) derive each provider's status + latency from `MetricsOps.systemHealth`, which the backend computes in
[`metrics-ops-read.prisma.repository.ts`](../../../api/src/modules/admin/infrastructure/metrics-ops-read.prisma.repository.ts) (`systemHealth()` → `providerHealth()`).

The derivation is **outbox-based**: a provider's health comes from the recent `SettlementOutbox` dispatch history for the settlement types it serves. This is correct for the two settling providers (Blockradar → `onchain_send`/`swap`, Flutterwave → `processor_collection`/`processor_payout`), but the three **non-settling** providers have `settlementTypes: []`:

- **Resend** (email), **WhatsApp Cloud** (chat + Flows), **Anthropic LLM** (`claude-opus-4-8`)

For those three, `providerHealth()` hardcodes `status:'ok', lastLatencyMs:null`. The card renders **"ok / —"**, which reads to an operator as _"no data / not working"_ — exactly the wrong signal for a go-readiness health panel. (Blockradar additionally shows "—" latency when it has no _completed_ `onchain_send`/`swap` outbox rows yet, but that is a data-availability artifact of the correct outbox path, not the bug being fixed here.)

There is already an **active connectivity probe** in the codebase — the `PROVIDER_PROBE` port + [`http-provider-probe.adapter.ts`](../../../api/src/modules/admin/infrastructure/http-provider-probe.adapter.ts) + [`admin-provider-probe.service.ts`](../../../api/src/modules/admin/application/admin-provider-probe.service.ts) — but it is wired **only** to the /providers "Test connection" button, and it currently returns `not_configured` for Resend/WhatsApp/Anthropic because their `PROBE_SPECS` entries have `baseUrlKey: null` (no known public host to probe credential-free).

## 2. Goal

Wire the existing active connectivity probe into the **System-health** path so the three non-settling providers show **real reachability status + observed latency**, cached so we never fire an external HTTP call synchronously on every dashboard load. Settling providers stay **outbox-derived, unchanged**. Preserve §3.1 (read-only, moves no money) and §3.3 (served under the existing permissioned, server-side-gated read).

### Non-goals

- No new `ProviderStatus` value (enum stays `ok | degraded | down`; `lastLatencyMs` stays nullable). No contract change, therefore **no frontend change** — the FE already renders `null → "—"`, a number → `"{n}ms"`, and `status` → dot colour.
- No change to the _settling_ providers' derivation.
- Not making Blockradar/Flutterwave fall back to a probe when their outbox window is empty (out of scope; the outbox path is authoritative for settling providers).

## 3. Design decisions (confirmed)

1. **Base branch:** new branch `feat/system-health-provider-probe` off `feat/admin-integration-reads` (the only branch carrying the target code; the previous worktree HEAD was a clean ancestor).
2. **Cache strategy:** **lazy TTL cache + single-flight** — cache the last snapshot; refresh at most once per TTL (`SNAPSHOT_TTL_MS = 45_000`); concurrent callers await one in-flight refresh. The first read per TTL window pays one bounded (`PROBE_TIMEOUT_MS = 4000`) probe round; steady-state reads hit the cache. No cron, no table. Explicitly **not** a synchronous probe on every `systemHealth()` call.
3. **One shared registry:** add the public base hosts once and let **both** the dashboard health path **and** the /providers "Test connection" button probe Resend/WhatsApp/Anthropic (DRY §13.2). This changes the Test-connection behaviour for those three (was `not_configured`) and its spec updates accordingly.

## 4. Architecture

Dependencies point inward (§4.1). `dependency-cruiser` forbids `application → infrastructure`/prisma but permits `infrastructure → application` (the port pattern), which is what lets the infra repo consult an application-owned connectivity port.

```
                 ┌────────────────────────────────────────────────┐
                 │ application/provider-probe-registry.ts (NEW)    │
                 │  PROVIDER_PROBE_SPECS  (5 providers, base URLs) │
                 │  resolveProbePosture(spec, get) → mock |        │
                 │     not_configured | { probe, baseUrl }         │  ← pure, shared
                 └───────────────┬─────────────────┬───────────────┘
                                 │                 │
        ┌────────────────────────┘                 └───────────────────────┐
        ▼                                                                   ▼
 AdminProviderProbeService (refactor)                 CachedProviderConnectivityAdapter (NEW, infra)
   /providers "Test connection" (on-demand,           implements IProviderConnectivity (application port)
   per-provider) → ProviderTestResponse               injects PROVIDER_PROBE + ConfigService + CLOCK
                                                       TTL cache (45s) + single-flight; snapshots all specs
                                                                 │  statusFor(key) → { status, latencyMs, observed }
                                                                 ▼
                                        MetricsOpsReadPrismaRepository.providerHealth() (overlay)
                                          settling providers  → outbox-derived (UNCHANGED)
                                          non-settling (settlementTypes: []):
                                             observed → probe status + latency
                                             else     → placeholder ok / null (today's behaviour)
```

Both the probe adapter (`PROVIDER_PROBE → HttpProviderProbeAdapter`) and `CLOCK` already exist and are bound.

## 5. Components

### 5.1 `application/provider-probe-registry.ts` (new)

Extracted from `AdminProviderProbeService`. Exports:

- `PROVIDER_PROBE_SPECS: readonly ProbeSpec[]` — the five providers. `baseUrlKey` now set for all five:
  | key | secretKey | mockModeKey | baseUrlKey |
  |---|---|---|---|
  | blockradar | `BLOCKRADAR_API_KEY` | `WALLET_MOCK_MODE` | `BLOCKRADAR_BASE_URL` |
  | flutterwave | `FLUTTERWAVE_SECRET_KEY` | `PAYMENTS_MOCK_MODE` | `FLUTTERWAVE_BASE_URL` |
  | resend | `RESEND_API_KEY` | `null` | `RESEND_BASE_URL` _(new env)_ |
  | whatsapp | `WHATSAPP_ACCESS_TOKEN` | `null` | `WHATSAPP_GRAPH_BASE_URL` _(existing)_ |
  | anthropic | `ANTHROPIC_API_KEY` | `null` | `ANTHROPIC_BASE_URL` _(new env)_ |
- `resolveProbePosture(spec, get)` — pure. `get` is a config accessor `(key) => string | number | undefined`.
  - mock-mode flag === `'true'` → `{ kind: 'mock' }`
  - secret absent **or** base URL absent/empty → `{ kind: 'not_configured' }`
  - otherwise → `{ kind: 'probe', baseUrl }`

### 5.2 New env keys (`env.schema.ts`, `.env.example`)

- `RESEND_BASE_URL: z.string().url().default('https://api.resend.com')`
- `ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com')`

Non-secret, default-valued → existing `.env` files still boot. WhatsApp reuses `WHATSAPP_GRAPH_BASE_URL` (default `https://graph.facebook.com`).

### 5.3 `AdminProviderProbeService` (refactor)

Consumes `PROVIDER_PROBE_SPECS` + `resolveProbePosture`. Same `ProviderTestResponse` mapping (`mock` / `not_configured` / `ok` / `degraded` / `down`; `down` → latency null). Behaviour change: Resend/WhatsApp/Anthropic now probe when their secret is present.

### 5.4 `application/ports/provider-connectivity.port.ts` (new)

```ts
export const PROVIDER_CONNECTIVITY = Symbol("PROVIDER_CONNECTIVITY");
export interface ProviderConnectivity {
  status: "ok" | "degraded" | "down";
  latencyMs: number | null;
  /** true = a real observed probe result; false = mock / not_configured / no host (no live signal). */
  observed: boolean;
}
export interface IProviderConnectivity {
  /** Cached liveness for a provider key (short TTL, single-flight). null if the key is unknown. */
  statusFor(key: string): Promise<ProviderConnectivity | null>;
}
```

### 5.5 `infrastructure/cached-provider-connectivity.adapter.ts` (new)

Implements `IProviderConnectivity`. Injects `@Inject(PROVIDER_PROBE) IProviderProbe`, `ConfigService<Env, true>`, `@Inject(CLOCK) Clock`. Singleton scope (cache persists across requests).

- `SNAPSHOT_TTL_MS = 45_000` — documented constant, consistent with the existing hardcoded `PROBE_TIMEOUT_MS`/`DEGRADED_LATENCY_MS` in the probe adapter.
- State: `snapshot: Map<key, ProviderConnectivity> | null`, `snapshotAt: number`, `inflight: Promise<void> | null`.
- `statusFor(key)` → `await ensureFresh(); return snapshot?.get(key) ?? null`.
- `ensureFresh()`: if `snapshot` fresh (`now - snapshotAt < TTL`) → return; if `inflight` → await it; else start `refresh()` as the single in-flight promise and await it.
- `refresh()`: `Promise.all` over `PROVIDER_PROBE_SPECS` → `probeOne(spec)`; set snapshot + `snapshotAt = clock.now().getTime()`.
- `probeOne(spec)`: `resolveProbePosture`; `mock`/`not_configured` → `{ status:'ok', latencyMs:null, observed:false }`; `probe` → `IProviderProbe.probe(baseUrl)` → map reachability to status, `down → latencyMs:null`, `observed:true`.

`clock.now()` makes TTL deterministically testable (advance the mocked clock). Credential-free — only the base URL crosses to the probe (§3.4/§3.5). Never throws (the probe port never throws).

### 5.6 `MetricsOpsReadPrismaRepository.providerHealth()` (overlay)

Inject `@Inject(PROVIDER_CONNECTIVITY) IProviderConnectivity` alongside `PrismaService`. For each provider in the existing `PROVIDERS` registry:

- `settlementTypes.length > 0` (settling) → **unchanged** outbox derivation (`statusOf`/`latencyOf`).
- `settlementTypes.length === 0` (non-settling) → `const c = await connectivity.statusFor(key)`; if `c?.observed` → `{ status: c.status, lastLatencyMs: c.latencyMs }`; else → `{ status: 'ok', lastLatencyMs: null }` (today's placeholder).

Docstring's "there is no synthetic provider probe" note updated to: settling = outbox-derived; non-settling = short-TTL cached liveness probe.

### 5.7 `admin.module.ts` (wiring)

Add `{ provide: PROVIDER_CONNECTIVITY, useClass: CachedProviderConnectivityAdapter }`. `PROVIDER_PROBE`, `ConfigService`, `CLOCK` already available. `MetricsOpsReadPrismaRepository` picks up the new constructor dep via DI.

## 6. Data flow (dashboard load)

1. `GET /admin/metrics/ops` (permissioned, read) → `AdminMetricsOpsService.ops()` → `repo.systemHealth()`.
2. `providerHealth()` derives settling providers from Prisma outbox rows; for non-settling providers calls `connectivity.statusFor(key)`.
3. The adapter serves the cached snapshot if fresh; otherwise runs one single-flight refresh (bounded 4s probes, in parallel) and caches it for 45s.
4. `MetricsOpsSchema.parse(...)` at the controller; FE renders unchanged.

## 7. Invariants / safety

- **§3.1** read-only, moves no money; the probe is a credential-free GET.
- **§3.3** served under the existing `RequirePermission('api_route','GET /admin/metrics/ops','read')` — server-side gate unchanged.
- **§3.4/§3.5** no secret VALUE leaves the process — only the base URL crosses to the probe port; assert this in tests.
- **§4.1 / dependency-cruiser** application→infra still forbidden; the infra repo consulting an application port is allowed and the pattern used.

## 8. Testing (strict TDD, red → green → refactor)

1. **`provider-probe-registry.spec.ts`** — `resolveProbePosture` branches: mock-mode → mock; missing secret → not_configured; missing base URL → not_configured; live → `{ probe, baseUrl }`, for a settling and a non-settling provider (incl. the new base URLs).
2. **`cached-provider-connectivity.adapter.spec.ts`** — mocked `IProviderProbe` + fake config + fake `Clock`:
   - probeable provider → observed status + latency; secret leak assertion (probe called with base URL only).
   - `down` → `latencyMs:null`, `observed:true`.
   - `not_configured` / `mock` → `observed:false`.
   - **single-flight:** N concurrent `statusFor` calls trigger exactly one `probe` per provider.
   - **TTL:** a second read within TTL does not re-probe; after advancing the clock past TTL it re-probes.
3. **`metrics-ops-read.prisma.repository.spec.ts`** (new) — mocked `PrismaService` + mocked `IProviderConnectivity`:
   - **settling** (blockradar/flutterwave) → status/latency from outbox rows; connectivity result ignored for them.
   - **non-settling** observed → probe status+latency overlaid.
   - **non-settling** not-observed → placeholder `ok`/`null`.
   - `webhookQueueDepth` / `reconDriftCount` from counts.
4. **`admin-provider-probe.service.spec.ts`** (update) — add the new base URLs to `LIVE_ENV`; Resend/WhatsApp/Anthropic now probe when secret present; `not_configured` only when the secret is absent.
5. **`env.schema.spec.ts`** (update if it asserts the parsed shape) — defaults for the two new keys.
6. No contracts test change (enum unchanged); no FE test change.

## 9. Files

**New:** `application/provider-probe-registry.ts` (+ spec), `application/ports/provider-connectivity.port.ts`, `infrastructure/cached-provider-connectivity.adapter.ts` (+ spec), `infrastructure/metrics-ops-read.prisma.repository.spec.ts`.
**Edit:** `application/admin-provider-probe.service.ts` (+ spec), `infrastructure/metrics-ops-read.prisma.repository.ts`, `admin.module.ts`, `core/config/env.schema.ts` (+ spec), `api/.env.example`.

## 10. Risks / drift

- Extracting the shared registry touches a shipped Phase-7 feature (`AdminProviderProbeService`) — mitigated by keeping the mapping identical and updating its spec.
- `SNAPSHOT_TTL_MS`/`PROBE_TIMEOUT_MS` are documented constants, not config. This matches the existing subsystem style but is mild §7 drift; noted for reviewer triage rather than expanding scope with more env keys.
- The 45s refresh probes all five specs (incl. the two settling hosts, whose result the repo ignores) to keep one shared registry — two extra external GETs per TTL window, negligible.
