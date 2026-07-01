import { z } from "zod";

// Admin PROVIDERS-ACTION DTOs (Phase 7, WRITE) — the "Test connection" liveness
// probe for a provider adapter on the Providers screen (design §6.27). The probe
// performs a real, non-mutating liveness check (a lightweight round-trip to the
// provider) and reports reachability + observed latency. It NEVER moves money
// (§3.1) and NEVER returns a secret VALUE — only a presence-derived probe outcome
// (root CLAUDE.md §3.4/§3.5). Single source of truth shared by the API (response
// parsing) and web-admin. No PII crosses this boundary — provider keys only.

// ── Probe outcome — reachability derived from the liveness check ─────────────────
//   • `ok`         — the provider responded within the probe window.
//   • `degraded`   — the provider responded but slowly / with a soft error.
//   • `down`       — the provider was unreachable or rejected the probe.
//   • `not_configured` — the adapter's secret is absent, so no probe was attempted
//     (fail-closed; we do NOT probe with an empty credential).
//   • `mock`       — the adapter is in mock mode; the probe is a no-op success.
export const ProviderProbeResultSchema = z.enum([
  "ok",
  "degraded",
  "down",
  "not_configured",
  "mock",
]);
export type ProviderProbeResult = z.infer<typeof ProviderProbeResultSchema>;

// ── Response: the probe outcome for one provider ─────────────────────────────────
// `key` echoes the probed provider; `result` is the reachability outcome;
// `latencyMs` is the observed round-trip latency when a probe ran, else null (mock /
// not_configured never measure a latency). `checkedAt` is the ISO time the probe
// ran. NO secret value, NO money movement — a pure read-side liveness signal (§3.1).
export const ProviderTestResponseSchema = z.object({
  key: z.string(),
  result: ProviderProbeResultSchema,
  latencyMs: z.number().nullable(),
  checkedAt: z.string(),
});
export type ProviderTestResponse = z.infer<typeof ProviderTestResponseSchema>;
