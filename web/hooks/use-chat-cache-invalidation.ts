"use client"

/**
 * Bug 3 — refresh the activity feed + balances when a chat transaction completes.
 *
 * The chat store (UI state) executes transactions but can't hold a TanStack
 * Query `queryClient` (that's server state, web/CLAUDE.md §5). So this hook —
 * mounted by each chat surface — injects a completion callback that invalidates
 * the activity + balances + transactions caches. Without it, a completed
 * transfer (especially an INSTANT internal transfer, which never hands off to
 * the settlement watcher) leaves those caches stale until a manual page reload.
 *
 * Idempotent: the store keeps a single mutable handler, so re-mounting or wiring
 * from both surfaces just re-sets the same behavior.
 */

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { defaultChatStore, type ChatStore } from "@/lib/store/chat-store"
import { qk } from "@/lib/query/keys"

export function useChatCacheInvalidation(store: ChatStore = defaultChatStore) {
  const queryClient = useQueryClient()

  useEffect(() => {
    store.getState().setTransactionCompleteHandler(() => {
      // The activity feed, wallet balances, and per-transaction reads all change
      // when a transaction settles — invalidate so they refetch immediately.
      void queryClient.invalidateQueries({ queryKey: qk.activity })
      void queryClient.invalidateQueries({ queryKey: qk.balances })
      void queryClient.invalidateQueries({ queryKey: qk.walletAssets })
      void queryClient.invalidateQueries({ queryKey: ["transaction"] })
    })
  }, [store, queryClient])
}
