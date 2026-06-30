/**
 * Typed admin-settings API clients — the layered-config (AppSetting) console
 * (root CLAUDE.md §7). Each function parses its input through the request schema
 * before the request fires and parses the response through the response schema
 * after (§3.3 / §8: the FE gate is UX, never the only check; shapes that cross
 * the boundary come from contracts).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  EffectiveSettingSchema,
  EffectiveSettingListResponseSchema,
  SettingsQuerySchema,
  UpdateSettingRequestSchema,
  type EffectiveSetting,
  type EffectiveSettingListResponse,
  type UpdateSettingRequest,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/settings — all effective settings, optionally filtered by category. */
export async function listSettings(
  category?: string
): Promise<EffectiveSettingListResponse> {
  const params = SettingsQuerySchema.parse(category ? { category } : {})
  const res = await api.get("/admin/settings", { params })
  return EffectiveSettingListResponseSchema.parse(res.data)
}

/** GET /admin/settings/:key — one effective setting by its dot-path key. */
export async function getSetting(key: string): Promise<EffectiveSetting> {
  const res = await api.get(`/admin/settings/${encodeURIComponent(key)}`)
  return EffectiveSettingSchema.parse(res.data)
}

/**
 * PATCH /admin/settings/:key — propose a new value. Sensitive: may 403 with code
 * ADMIN_STEP_UP_REQUIRED (caller retries after step-up), or 4xx with code
 * ADMIN_SETTING_INVALID / ADMIN_MULTI_CURRENCY_INVARIANT. Returns the re-resolved
 * effective setting on success.
 */
export async function updateSetting(
  key: string,
  input: UpdateSettingRequest
): Promise<EffectiveSetting> {
  const body = UpdateSettingRequestSchema.parse(input)
  const res = await api.patch(
    `/admin/settings/${encodeURIComponent(key)}`,
    body
  )
  return EffectiveSettingSchema.parse(res.data)
}
