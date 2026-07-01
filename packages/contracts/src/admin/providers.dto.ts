import { z } from "zod";

// Admin Providers DTOs (Phase 6b) — the READ-ONLY provider-registry view for the
// operator Providers screen (design §6.27). One card per external adapter
// (Blockradar / Flutterwave / Resend / WhatsApp / Anthropic): its non-secret
// wiring, mock-mode, bound capabilities, a status DERIVED from configuration
// posture, and secret-PRESENCE booleans — the secret VALUES never cross this
// boundary (root CLAUDE.md §3.4/§3.5), plus a mock→live readiness checklist whose
// every item is derived from a real config signal.
//
// This subsystem is READ-ONLY (§3.1) and never moves money. It carries NO secret
// values and NO live-probe latency — status is posture-derived, not a synthetic
// probe (test-connection / key-reveal are Phase 7).

// ─── Provider card ────────────────────────────────────────────────────────────────

/**
 * A provider adapter's operational status, DERIVED from configuration posture
 * (never a live probe):
 * - `mock`     — the adapter is wrapped in a mock (its `*_MOCK_MODE` flag is on).
 * - `down`     — the adapter is live but its required secret is absent (unusable).
 * - `ok`       — the adapter is live and its required secret is present.
 * `degraded` is reserved for a future live health probe (Phase 7) and is a valid
 * status the FE renders, but this read endpoint never emits it today.
 */
export const ProviderRegistryStatusEnum = z.enum([
  "ok",
  "degraded",
  "down",
  "mock",
]);
export type ProviderRegistryStatus = z.infer<typeof ProviderRegistryStatusEnum>;

/**
 * One provider-registry card. Every field is derived from the layered config /
 * env posture. `hasSecret` is a PRESENCE boolean only — the key VALUE is never
 * returned (§3.4/§3.5). `latencyMs` is always null here (no live probe; the FE
 * shows the status word alone until a Phase-7 health probe supplies latency).
 */
export const ProviderCardViewSchema = z.object({
  /** Stable key + a11y root, e.g. "blockradar". */
  key: z.string(),
  /** Human display name, e.g. "Blockradar". */
  name: z.string(),
  /** The adapter category line under the name, e.g. "Custodial crypto WaaS · TRON". */
  kind: z.string(),
  status: ProviderRegistryStatusEnum,
  /** True iff this adapter is running in mock mode (its `*_MOCK_MODE` flag is on). */
  mock: z.boolean(),
  /** True iff the adapter's required secret is configured — the VALUE is never returned. */
  hasSecret: z.boolean(),
  /** The bound capabilities line, e.g. "crypto.buy · sell · send · swap". */
  capabilities: z.array(z.string()),
  /**
   * Most recent observed round-trip latency (ms) if a live probe supplies one,
   * else null. This read endpoint never probes, so it is always null today.
   */
  latencyMs: z.number().nullable(),
});
export type ProviderCardView = z.infer<typeof ProviderCardViewSchema>;

// ─── Mock → live readiness checklist ──────────────────────────────────────────────

/**
 * One mock→live readiness gate. `done` is COMPUTED from a real config signal
 * (not a hardcoded flag); the label states the requirement. The FE renders a
 * check tile when done, a pending-dash tile otherwise.
 */
export const ProviderReadinessItemSchema = z.object({
  /** Stable key, e.g. "live-keys" | "mock-off" | "webhooks" | "recon" | "swap". */
  key: z.string(),
  /** Human requirement line, e.g. "Live API keys provisioned for every enabled provider". */
  label: z.string(),
  /** True iff the underlying config signal shows this gate is satisfied. */
  done: z.boolean(),
});
export type ProviderReadinessItem = z.infer<typeof ProviderReadinessItemSchema>;

// ─── Composite registry view ──────────────────────────────────────────────────────

/**
 * The composite Providers-screen payload: the per-provider registry cards and the
 * mock→live readiness checklist in one round-trip. READ-ONLY; carries no secret
 * values and never moves money (§3.1).
 */
export const ProviderRegistryViewSchema = z.object({
  providers: z.array(ProviderCardViewSchema),
  readiness: z.array(ProviderReadinessItemSchema),
});
export type ProviderRegistryView = z.infer<typeof ProviderRegistryViewSchema>;
