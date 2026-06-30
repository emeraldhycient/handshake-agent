/**
 * TanStack Query hooks — data layer.
 *
 * All hooks call `gateway` (mock-or-real switch) and use the `qk` key factory.
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { gateway } from "@/lib/api/gateway"
import type { TransactionHistoryPageParams } from "@/lib/api/gateway"
import { getTransaction, getTransactionDetail } from "@/lib/api/chat"
import type { ChatAction } from "@/lib/schemas"
import { qk } from "./keys"

// ─── Read hooks ───────────────────────────────────────────────────────────────

/**
 * Supported currencies, networks, and assets from the /config endpoint.
 * Drives which services are enabled — do NOT hardcode the basket in components.
 * Cached for 5 min; re-fetched in the background.
 */
export function useConfig() {
  return useQuery({
    queryKey: qk.config,
    queryFn: () => gateway.getConfig(),
    staleTime: 5 * 60_000,
  })
}

/** Wallet summary (total + asset breakdown). Refreshed every 15 s. */
export function useBalances() {
  return useQuery({
    queryKey: qk.balances,
    queryFn: () => gateway.getBalances(),
    staleTime: 15_000,
  })
}

/** Per-asset wallet rows (sym, name, amount, value, change). Refreshed every 15 s. */
export function useWalletAssets() {
  return useQuery({
    queryKey: qk.walletAssets,
    queryFn: () => gateway.getWalletAssets(),
    staleTime: 15_000,
  })
}

/** Paginated activity / transaction history. Refreshed every 15 s. */
export function useActivity() {
  return useQuery({
    queryKey: qk.activity,
    queryFn: () => gateway.getActivity(),
    staleTime: 15_000,
  })
}

/**
 * "Show more" for the chat transactions card. A mutation (not a query) because
 * it is an imperative, click-driven fetch of the NEXT keyset page of an
 * already-resolved (frozen) window — the card owns the accumulated rows/cursor
 * as local UI state and calls this to append the next page.
 */
export function useLoadMoreTransactions() {
  return useMutation({
    mutationFn: (params: TransactionHistoryPageParams) =>
      gateway.getTransactionHistoryPage(params),
  })
}

/**
 * Deposit address for the user's wallet.
 * `staleTime: Infinity` — addresses are stable; no need to re-fetch
 * until the query is explicitly invalidated (e.g. on account change).
 */
export function useDepositAddress() {
  return useQuery({
    queryKey: qk.deposit,
    queryFn: () => gateway.getDepositAddress(),
    staleTime: Infinity,
  })
}

/** Upcoming event listings. Refreshed every 5 min. */
export function useEvents() {
  return useQuery({
    queryKey: qk.events,
    queryFn: () => gateway.getEvents(),
    staleTime: 300_000,
  })
}

/** In-app notification feed. Refreshed every 30 s. */
export function useNotifications() {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => gateway.getNotifications(),
    staleTime: 30_000,
  })
}

/** Global search catalog (actions + pages + recent transactions). Refreshed every 5 min. */
export function useSearchCatalog() {
  return useQuery({
    queryKey: qk.searchCatalog,
    queryFn: () => gateway.getSearchCatalog(),
    staleTime: 300_000,
  })
}

/**
 * Poll a transaction's status — used by PayInCardLive after executeProposal
 * returns status:"settling". Refetches every 4 s until status === "completed"
 * or the query is disabled.
 *
 * Pass `enabled: false` to pause polling (e.g. once completed).
 */
export function useTransactionStatus(
  transactionId: string | null,
  options?: { enabled?: boolean }
) {
  const isCompleted = false // caller can derive this from data and pass enabled
  return useQuery({
    queryKey: qk.transactionStatus(transactionId ?? ""),
    queryFn: () => getTransaction(transactionId!),
    enabled: !!transactionId && options?.enabled !== false && !isCompleted,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === "completed" || status === "failed") return false
      return 4_000
    },
  })
}

/**
 * Fetch the full detail for a single transaction — used by TransactionDetailModal.
 * One-shot query (no refetchInterval). Enabled only when `transactionId` is set.
 * `staleTime: Infinity` — the detail page shows historical data; it doesn't change.
 */
export function useTransactionDetail(transactionId: string | null) {
  return useQuery({
    queryKey: qk.transactionDetail(transactionId ?? ""),
    queryFn: () => getTransactionDetail(transactionId!),
    enabled: !!transactionId,
    staleTime: Infinity,
  })
}

// ─── Mutation hooks ───────────────────────────────────────────────────────────

/**
 * Real-API scaffolding — intentionally retained.
 * The prototype's chat flow currently drives quote/receipt state via `@/lib/chat/flow`
 * builders and the Zustand store. These hooks wire the real gateway + idempotency-key
 * + balances-invalidation and will replace that store flow once the backend is live.
 */

/** Fetch a quote for a given chat action (buy / send / swap). */
export function useCreateQuote() {
  return useMutation({
    mutationFn: (action: ChatAction) => gateway.createQuote(action),
  })
}

/**
 * Execute a transaction.
 *
 * A fresh idempotency key is generated per call so retries from the UI layer
 * carry a new key (the gateway / backend deduplicates by key). Callers that
 * need deterministic keys (e.g. the mock's memoization) can pass `meta` to
 * influence the operation but cannot override the key — that is always fresh.
 *
 * On success the balances query is invalidated so the UI reflects the new state
 * without a manual refetch.
 */
export function useExecuteTransaction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      action,
      meta,
    }: {
      action: ChatAction
      meta?: Record<string, string>
    }) =>
      gateway.executeTransaction(
        action,
        // Fresh UUID per call — idempotency at the call-site level, not cached.
        crypto.randomUUID(),
        meta
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.balances })
    },
  })
}
