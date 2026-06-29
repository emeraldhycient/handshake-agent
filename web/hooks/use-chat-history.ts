"use client"

/**
 * Loads the authenticated user's conversation history (server state) and
 * hydrates the chat store thread for the given surface.
 *
 * Server state lives in TanStack Query (web/CLAUDE.md §5); the chat store is UI
 * state, so history is fetched here and pushed into the store once. Hydration is
 * idempotent per surface (the store guards re-hydration), and it never mutates
 * overlay/pin state, so the pinComplete/overlay invariants are untouched.
 */

import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchChatHistory } from "@/lib/api/chat"
import { useAuthStore } from "@/lib/store/auth-store"
import { defaultChatStore, type ChatStore } from "@/lib/store/chat-store"
import { qk } from "@/lib/query/keys"
import type { ChatSurface } from "@/lib/schemas"

export function useChatHistory(
  surface: ChatSurface,
  store: ChatStore = defaultChatStore
) {
  const status = useAuthStore((s) => s.status)

  const query = useQuery({
    queryKey: qk.chatHistory,
    queryFn: () => fetchChatHistory(),
    enabled: status === "authenticated",
    // History is a session snapshot; new turns append to the store live, so we
    // don't want background refetches clobbering the thread.
    staleTime: Infinity,
  })

  const { data } = query
  useEffect(() => {
    if (data) {
      store.getState().hydrateHistory(surface, data.messages)
    }
  }, [data, surface, store])

  return query
}
