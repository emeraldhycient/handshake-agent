/**
 * Gateway — single import point for all API calls.
 *
 * NEXT_PUBLIC_USE_MOCK controls which implementation is used. The default is
 * the REAL gateway (the real backend) — set NEXT_PUBLIC_USE_MOCK="true" to use
 * the in-memory mock (the test suite forces this in vitest.setup.ts; local dev
 * can opt in via web/.env.local):
 *   "true"  → mock/index.ts (in-memory, no network)
 *   other   → realGateway (Axios → real backend) — the default
 *
 * Components and query hooks import `gateway`, never `mock` directly.
 */

import { api } from "./client"
import * as mock from "./mock/index"
import { mapWalletBalances, mapWalletAssets } from "./mappers/wallet"
import { mapHistoryItemToRow } from "./mappers/history-row"
import { mapNotifications } from "./mappers/notifications"
import { mapDepositAddress } from "./mappers/deposit"
import { QuoteViewSchema, ReceiptViewSchema } from "@/lib/schemas"
import type {
  BalanceView,
  WalletAsset,
  DepositView,
  EventListItem,
  AppNotification,
  SearchResult,
  QuoteView,
  ReceiptView,
  ChatAction,
  TransactionRow,
} from "@/lib/schemas"
import {
  PublicConfigResponseSchema,
  type PublicConfigResponse,
  type TransactionListItem,
  WalletBalancesResponseSchema,
  DepositAddressResponseSchema,
  TransactionListResponseSchema,
  TransactionHistoryResponseSchema,
  NotificationListResponseSchema,
} from "@handshake-agent/contracts"

/** A raw page of activity-feed transactions (mapped to groups in the hook, where
 *  the `/config` fiat symbols are available — keeps NGN out of the gateway). */
export interface ActivityPage {
  items: TransactionListItem[]
  nextCursor: string | null
}

/** A loaded page of chat transaction-history rows (the "Show more" payload). */
export interface TransactionHistoryPage {
  rows: TransactionRow[]
  hasMore: boolean
  nextCursor: string | null
}

/** Params for fetching the next keyset page of a FROZEN history window. */
export interface TransactionHistoryPageParams {
  from: string
  to: string
  txType: string
  cursor: string
}

// ─── Type alias for the gateway contract ─────────────────────────────────────

export interface Gateway {
  getConfig(): Promise<PublicConfigResponse>
  getBalances(): Promise<BalanceView>
  getWalletAssets(): Promise<WalletAsset[]>
  getActivityPage(cursor?: string): Promise<ActivityPage>
  getTransactionHistoryPage(
    params: TransactionHistoryPageParams
  ): Promise<TransactionHistoryPage>
  getDepositAddress(): Promise<DepositView>
  getEvents(): Promise<EventListItem[]>
  getNotifications(): Promise<AppNotification[]>
  getSearchCatalog(): Promise<SearchResult[]>
  createQuote(action: ChatAction): Promise<QuoteView>
  executeTransaction(
    action: ChatAction,
    idempotencyKey: string,
    meta?: Record<string, string>
  ): Promise<ReceiptView>
}

// ─── Real gateway (wraps the Axios client) ────────────────────────────────────
//
// Each data read fetches a structured contract DTO, validates it with Zod, and
// maps it to the presentation "view" shape via lib/api/mappers/*. Events and the
// search catalog have no backend yet (ticketing is deferred and hidden via the
// /config capabilities), so they delegate to the mock.
//   GET  /config
//   GET  /wallets/balances        → BalanceView / WalletAsset[]
//   GET  /transactions            → ActivityPage (raw; grouped in the hook)
//   GET  /wallets/deposit-address → DepositView
//   GET  /notifications           → AppNotification[]
//   POST /quotes · POST /transactions (chat flow — unchanged)

const realGateway: Gateway = {
  async getConfig() {
    const { data } = await api.get("/config")
    return PublicConfigResponseSchema.parse(data)
  },

  async getBalances() {
    const { data } = await api.get("/wallets/balances")
    return mapWalletBalances(WalletBalancesResponseSchema.parse(data))
  },

  async getWalletAssets() {
    const { data } = await api.get("/wallets/balances")
    return mapWalletAssets(WalletBalancesResponseSchema.parse(data))
  },

  async getActivityPage(cursor?: string) {
    const { data } = await api.get("/transactions", {
      params: cursor ? { cursor } : {},
    })
    const res = TransactionListResponseSchema.parse(data)
    return { items: res.items, nextCursor: res.nextCursor ?? null }
  },

  async getTransactionHistoryPage(params: TransactionHistoryPageParams) {
    // `cursor` present → the backend pages the FROZEN absolute window (queryPage).
    const { data } = await api.get("/transactions/history", { params })
    const res = TransactionHistoryResponseSchema.parse(data)
    return {
      rows: res.items.map(mapHistoryItemToRow),
      hasMore: res.hasMore,
      nextCursor: res.nextCursor,
    }
  },

  async getDepositAddress() {
    const { data } = await api.get("/wallets/deposit-address")
    return mapDepositAddress(DepositAddressResponseSchema.parse(data))
  },

  // Not yet backed by a real endpoint — hidden by /config capabilities.
  getEvents: mock.getEvents,
  getSearchCatalog: mock.getSearchCatalog,

  async getNotifications() {
    const { data } = await api.get("/notifications")
    return mapNotifications(NotificationListResponseSchema.parse(data))
  },

  async createQuote(action: ChatAction) {
    const { data } = await api.post("/quotes", { action })
    return QuoteViewSchema.parse(data)
  },

  async executeTransaction(
    action: ChatAction,
    idempotencyKey: string,
    meta?: Record<string, string>
  ) {
    const { data } = await api.post(
      "/transactions",
      { action, idempotencyKey, meta },
      // Forward the caller's key so the interceptor's ??= preserves it instead
      // of minting a new UUID — the backend uses this header for dedup.
      { headers: { "Idempotency-Key": idempotencyKey } }
    )
    return ReceiptViewSchema.parse(data)
  },
}

// ─── Gateway switch ───────────────────────────────────────────────────────────

// Explicit typed assignment so TypeScript enforces that the mock module fully
// satisfies the Gateway contract — any missing method is a compile-time error.
const mockGateway: Gateway = mock

// Real by default; the mock is opt-in via NEXT_PUBLIC_USE_MOCK="true".
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === "true"

export const gateway: Gateway = USE_MOCK ? mockGateway : realGateway
