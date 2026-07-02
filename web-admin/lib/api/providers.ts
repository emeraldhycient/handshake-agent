/**
 * Typed admin Providers-registry API client (Phase 6b) — a single read-only view
 * of the five external adapters (Blockradar / Flutterwave / Resend / WhatsApp /
 * Anthropic): per-provider non-secret wiring, mock-mode, bound capabilities, a
 * posture-derived status, and secret-PRESENCE booleans (the secret VALUES never
 * cross this boundary — root CLAUDE.md §3.4/§3.5), plus the mock→live readiness
 * checklist. Parses the response through the contract schema.
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  ProviderRegistryViewSchema,
  ProviderTestResponseSchema,
  type ProviderRegistryView,
  type ProviderTestResponse,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/providers — provider registry cards + readiness checklist. */
export async function getProviderRegistry(): Promise<ProviderRegistryView> {
  const res = await api.get("/admin/providers")
  return ProviderRegistryViewSchema.parse(res.data)
}

/**
 * POST /admin/providers/:key/test — run a provider liveness probe (Phase 7). A real,
 * credential-free reachability check — exposes NO secret value (§3.4/§3.5) and moves
 * NO money (§3.1). Sensitive — may 403 with ADMIN_STEP_UP_REQUIRED (the caller wraps
 * in `useStepUpRetry`). Parses the response through the contract schema.
 */
export async function testProviderConnection(
  key: string
): Promise<ProviderTestResponse> {
  const res = await api.post(`/admin/providers/${key}/test`)
  return ProviderTestResponseSchema.parse(res.data)
}
