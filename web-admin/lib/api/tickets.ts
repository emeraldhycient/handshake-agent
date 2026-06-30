/**
 * Typed admin tickets API client (Phase 4) — a single read-only projection of the
 * `TicketOrder` rows. There is no tickets module yet; the admin console only
 * LISTS existing orders. Nothing here moves money (§3.1). Parses the response
 * through the contract schema.
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  TicketOrderListResponseSchema,
  type TicketOrderListResponse,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** GET /admin/tickets/orders — existing ticket orders (read-only). */
export async function listTicketOrders(): Promise<TicketOrderListResponse> {
  const res = await api.get("/admin/tickets/orders")
  return TicketOrderListResponseSchema.parse(res.data)
}
