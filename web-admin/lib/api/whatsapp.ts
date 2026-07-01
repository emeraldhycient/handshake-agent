/**
 * Typed admin WhatsApp-config API client (Phase 4) — a single read-only view of
 * the NON-SECRET Cloud-API / Flows wiring (graph version + ids) plus boolean
 * presence flags for each secret. The secret VALUES never cross this boundary
 * (root CLAUDE.md §3.5). Parses the response through the contract schema.
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  WhatsAppConfigViewSchema,
  type WhatsAppConfigView,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/whatsapp/config — non-secret wiring + secret-presence flags. */
export async function getWhatsAppConfig(): Promise<WhatsAppConfigView> {
  const res = await api.get("/admin/whatsapp/config")
  return WhatsAppConfigViewSchema.parse(res.data)
}
