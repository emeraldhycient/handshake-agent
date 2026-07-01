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
  PublicConfigResponseSchema,
  type PublicConfigResponse,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /config — the enabled fiats, crypto assets, networks, and capability flags. */
export async function getPublicConfig(): Promise<PublicConfigResponse> {
  const res = await api.get("/config")
  return PublicConfigResponseSchema.parse(res.data)
}
