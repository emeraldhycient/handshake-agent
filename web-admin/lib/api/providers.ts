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
  type ProviderRegistryView,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/providers — provider registry cards + readiness checklist. */
export async function getProviderRegistry(): Promise<ProviderRegistryView> {
  const res = await api.get("/admin/providers")
  return ProviderRegistryViewSchema.parse(res.data)
}
