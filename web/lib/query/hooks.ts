/**
 * TanStack Query hooks — data layer.
 *
 * All hooks call `gateway` (mock-or-real switch) and use the `qk` key factory.
 * This file lives in `lib/` and must NOT import from `components/` or `app/`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { gateway } from "@/lib/api/gateway"
import type { ChatAction } from "@/lib/schemas"
import { qk } from "./keys"

// ─── Read hooks ───────────────────────────────────────────────────────────────

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

// ─── Mutation hooks ───────────────────────────────────────────────────────────

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
