/**
 * Gateway — single import point for all API calls.
 *
 * NEXT_PUBLIC_USE_MOCK (default "true") controls which implementation is used:
 *   "true"  → mock/index.ts (in-memory, no network)
 *   "false" → realGateway (Axios → real backend)
 *
 * Components and query hooks import `gateway`, never `mock` directly.
 */

import { api } from "./client"
import * as mock from "./mock/index"
import {
  BalanceViewSchema,
  WalletAssetSchema,
  ActivityGroupSchema,
  DepositViewSchema,
  EventListItemSchema,
  AppNotificationSchema,
  SearchResultSchema,
  QuoteViewSchema,
  ReceiptViewSchema,
} from "@/lib/schemas"
import type {
  BalanceView,
  WalletAsset,
  ActivityGroup,
  DepositView,
  EventListItem,
  AppNotification,
  SearchResult,
  QuoteView,
  ReceiptView,
  ChatAction,
} from "@/lib/schemas"
import { z } from "zod"

// ─── Type alias for the gateway contract ─────────────────────────────────────

export interface Gateway {
  getBalances(): Promise<BalanceView>
  getWalletAssets(): Promise<WalletAsset[]>
  getActivity(): Promise<ActivityGroup[]>
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
// Endpoint paths are conventional REST routes. When the real API is wired up,
// adjust them to match the backend router. Paths kept minimal here:
//   GET  /api/wallets/balances
//   GET  /api/wallets/assets
//   GET  /api/activity
//   GET  /api/wallets/deposit-address
//   GET  /api/events
//   GET  /api/notifications
//   GET  /api/search/catalog
//   POST /api/quotes
//   POST /api/transactions

const realGateway: Gateway = {
  async getBalances() {
    const { data } = await api.get("/wallets/balances")
    return BalanceViewSchema.parse(data)
  },

  async getWalletAssets() {
    const { data } = await api.get("/wallets/assets")
    return z.array(WalletAssetSchema).parse(data)
  },

  async getActivity() {
    const { data } = await api.get("/activity")
    return z.array(ActivityGroupSchema).parse(data)
  },

  async getDepositAddress() {
    const { data } = await api.get("/wallets/deposit-address")
    return DepositViewSchema.parse(data)
  },

  async getEvents() {
    const { data } = await api.get("/events")
    return z.array(EventListItemSchema).parse(data)
  },

  async getNotifications() {
    const { data } = await api.get("/notifications")
    return z.array(AppNotificationSchema).parse(data)
  },

  async getSearchCatalog() {
    const { data } = await api.get("/search/catalog")
    return z.array(SearchResultSchema).parse(data)
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

const USE_MOCK = (process.env.NEXT_PUBLIC_USE_MOCK ?? "true") !== "false"

export const gateway: Gateway = USE_MOCK ? mockGateway : realGateway
