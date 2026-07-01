/**
 * In-memory mock API — returns fixture data parsed through schemas.
 *
 * delay() resolves immediately in test environments (NODE_ENV === "test") so
 * the test suite stays fast; in browser/dev it waits the given ms for realism.
 */

import {
  balanceFixture,
  walletAssetsFixture,
  depositFixture,
  eventsFixture,
  notificationsFixture,
  searchCatalogFixture,
} from "@/lib/api/fixtures"
import * as flow from "@/lib/chat/flow"
import {
  BalanceViewSchema,
  WalletAssetSchema,
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
} from "@handshake-agent/contracts"
import { z } from "zod"

// ─── Delay helper ─────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  if (process.env.NODE_ENV === "test") return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Idempotency store for executeTransaction ─────────────────────────────────

const receiptCache = new Map<string, ReceiptView>()

// ─── Config fixture ───────────────────────────────────────────────────────────

const configFixture = {
  fiats: [
    { code: "NGN", displayName: "Nigerian Naira", symbol: "₦", decimals: 2 },
  ],
  assets: [
    {
      symbol: "USDT",
      displayName: "Tether USD",
      decimals: 6,
      networks: ["tron"],
    },
  ],
  networks: [{ id: "tron", displayName: "TRON (TRC-20)" }],
  capabilities: { "crypto.buy": true, "crypto.sell": true, send: true },
}

// ─── Reader functions ─────────────────────────────────────────────────────────

export async function getConfig(): Promise<PublicConfigResponse> {
  await delay(100)
  return PublicConfigResponseSchema.parse(configFixture)
}

export async function getBalances(): Promise<BalanceView> {
  await delay(200)
  return BalanceViewSchema.parse(balanceFixture)
}

export async function getWalletAssets(): Promise<WalletAsset[]> {
  await delay(200)
  return z.array(WalletAssetSchema).parse(walletAssetsFixture)
}

export async function getActivityPage(): Promise<{
  items: TransactionListItem[]
  nextCursor: string | null
}> {
  // Single in-memory page. Timestamps are "now" so the hook's day-grouping
  // labels them "Today" regardless of when the suite runs. The hook maps these
  // raw items to display groups using the /config fiat symbols.
  await delay(250)
  const now = new Date().toISOString()
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const items: TransactionListItem[] = [
    {
      id: "act-today-1",
      type: "buy",
      status: "completed",
      asset: "USDT",
      cryptoAmount: "29.97",
      fiatAmount: "50000",
      fiatCurrency: "NGN",
      createdAt: now,
    },
    {
      id: "act-today-2",
      type: "send",
      status: "settling",
      asset: "USDT",
      cryptoAmount: "26.00",
      counterparty: "TQn9YgkXgk7r",
      createdAt: now,
    },
    {
      id: "act-yest-1",
      type: "deposit",
      status: "completed",
      asset: "USDT",
      cryptoAmount: "12.00",
      createdAt: yesterday,
    },
  ]
  return { items, nextCursor: null }
}

export async function getTransactionHistoryPage(): Promise<{
  rows: TransactionRow[]
  hasMore: boolean
  nextCursor: string | null
}> {
  // The mock fixture is a single page; there is never a next page to load.
  await delay(150)
  return { rows: [], hasMore: false, nextCursor: null }
}

export async function getDepositAddress(): Promise<DepositView> {
  await delay(150)
  return DepositViewSchema.parse(depositFixture)
}

export async function getEvents(): Promise<EventListItem[]> {
  await delay(300)
  return z.array(EventListItemSchema).parse(eventsFixture)
}

export async function getNotifications(): Promise<AppNotification[]> {
  await delay(150)
  return z.array(AppNotificationSchema).parse(notificationsFixture)
}

export async function getSearchCatalog(): Promise<SearchResult[]> {
  await delay(150)
  return z.array(SearchResultSchema).parse(searchCatalogFixture)
}

// ─── createQuote ──────────────────────────────────────────────────────────────

/**
 * Returns the QuoteView from buildResponse(action).
 * Throws if the action produces no quote (balance, receive, ticket).
 */
export async function createQuote(action: ChatAction): Promise<QuoteView> {
  await delay(300)
  const { messages } = flow.buildResponse(action)
  const quoteMsg = messages.find((m) => m.kind === "quote")
  if (!quoteMsg) {
    throw new Error(`createQuote: no quote for action "${action}"`)
  }
  // quoteMsg is already a QuoteView — parse defensively
  return QuoteViewSchema.parse(quoteMsg)
}

// ─── executeTransaction ───────────────────────────────────────────────────────

/**
 * Builds a receipt for the given action and memoizes it by idempotencyKey.
 * Subsequent calls with the same key return the stored receipt (deep-equal).
 */
export async function executeTransaction(
  action: ChatAction,
  idempotencyKey: string,
  meta?: Record<string, string>
): Promise<ReceiptView> {
  await delay(500)

  const cached = receiptCache.get(idempotencyKey)
  if (cached) return cached

  const receipt = ReceiptViewSchema.parse(flow.buildReceipt(action, meta))
  receiptCache.set(idempotencyKey, receipt)
  return receipt
}
