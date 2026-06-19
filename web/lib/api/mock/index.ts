/**
 * In-memory mock API — returns fixture data parsed through schemas.
 *
 * delay() resolves immediately in test environments (NODE_ENV === "test") so
 * the test suite stays fast; in browser/dev it waits the given ms for realism.
 */

import {
  balanceFixture,
  walletAssetsFixture,
  activityFixture,
  depositFixture,
  eventsFixture,
  notificationsFixture,
  searchCatalogFixture,
} from "@/lib/api/fixtures"
import * as flow from "@/lib/chat/flow"
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

// ─── Delay helper ─────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  if (process.env.NODE_ENV === "test") return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Idempotency store for executeTransaction ─────────────────────────────────

const receiptCache = new Map<string, ReceiptView>()

// ─── Reader functions ─────────────────────────────────────────────────────────

export async function getBalances(): Promise<BalanceView> {
  await delay(200)
  return BalanceViewSchema.parse(balanceFixture)
}

export async function getWalletAssets(): Promise<WalletAsset[]> {
  await delay(200)
  return z.array(WalletAssetSchema).parse(walletAssetsFixture)
}

export async function getActivity(): Promise<ActivityGroup[]> {
  await delay(250)
  return z.array(ActivityGroupSchema).parse(activityFixture)
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
