/**
 * Typed admin ledger API clients — read-only double-entry ledger oversight plus a
 * per-transaction integrity check (Phase 3, sub-area A). Each parses the response
 * through its contract schema (§3.3 / §8: the FE gate is UX, never the only check;
 * shapes that cross the boundary come from contracts).
 *
 * The history query triple (accountType, accountId, currency) is an internal read
 * query scoped to the presentation layer of the API — it is not a cross-boundary
 * request body, so the param shape is declared locally here (mirrors the API DTO).
 * Verify NEVER mutates: it re-sums existing legs and reports whether each currency
 * nets to zero (§3.1).
 *
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import {
  AdminLedgerHistoryResponseSchema,
  AdminLedgerIntegrityResultSchema,
  type AdminLedgerHistoryResponse,
  type AdminLedgerIntegrityResult,
} from "@handshake-agent/contracts"

import { api } from "./client"

/** The account-scoped ledger-history query (mirrors the API presentation DTO). */
export interface LedgerHistoryQuery {
  accountType: string
  accountId: string
  currency: string
  limit?: number
}

/** GET /admin/ledger — an account's posted ledger entries (newest first). */
export async function listLedgerHistory(
  query: LedgerHistoryQuery
): Promise<AdminLedgerHistoryResponse> {
  const res = await api.get("/admin/ledger", { params: query })
  return AdminLedgerHistoryResponseSchema.parse(res.data)
}

/** POST /admin/ledger/verify/:transactionId — re-sum a transaction's legs (read-only). */
export async function verifyLedger(
  transactionId: string
): Promise<AdminLedgerIntegrityResult> {
  const res = await api.post(`/admin/ledger/verify/${transactionId}`, {})
  return AdminLedgerIntegrityResultSchema.parse(res.data)
}
