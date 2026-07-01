/**
 * Typed public-config API client — the non-secret asset / fiat / network catalog
 * (root CLAUDE.md §7). `GET /config` returns the effective, enabled catalog with
 * capability flags; `AssetRegistry.publicView()` strips every secret server-side,
 * so this response carries no sensitive fields.
 *
 * The response is parsed through `PublicConfigResponseSchema` after the request
 * (§8: shapes that cross the boundary come from contracts; §3.3: the FE parse is
 * defence-in-depth, never the only gate).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  EffectiveSettingListResponseSchema,
  EffectiveSettingSchema,
  PublicConfigResponseSchema,
  type EffectiveSetting,
  type PublicConfigResponse,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /config — the enabled fiats, crypto assets, networks, and capability flags. */
export async function getPublicConfig(): Promise<PublicConfigResponse> {
  const res = await api.get("/config")
  return PublicConfigResponseSchema.parse(res.data)
}

/**
 * GET /admin/settings — the effective view of every non-secret registry key
 * (root CLAUDE.md §7, DB-admin › env › JSON). Each row pairs a SETTING_REGISTRY
 * entry's metadata (key/category/label/valueType/editable/scope) with its current
 * effective `value` and provenance (`source`: 'db' override vs 'default'). An
 * optional `category` narrows the list to one registry category (e.g. "Pricing",
 * "KYC", "Catalog"). Read-only — edits go through the step-up-guarded PATCH (Phase 7).
 * The response is parsed through the contract schema (§8/§3.3: defence-in-depth).
 */
export async function listEffectiveSettings(
  category?: string
): Promise<EffectiveSetting[]> {
  const res = await api.get("/admin/settings", {
    params: category ? { category } : undefined,
  })
  return EffectiveSettingListResponseSchema.parse(res.data).settings
}

/** GET /admin/settings/:key — one registry key's effective value + provenance. */
export async function getSetting(key: string): Promise<EffectiveSetting> {
  const res = await api.get(`/admin/settings/${encodeURIComponent(key)}`)
  return EffectiveSettingSchema.parse(res.data)
}
