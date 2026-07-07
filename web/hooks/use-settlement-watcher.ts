"use client"

import { useEffect } from "react"
import { useTransactionStatus } from "@/lib/query/hooks"
import { useChatStore } from "@/lib/store/chat-store"

/**
 * The single settlement watcher for an in-flight pay-in / sell / send (C4).
 * Polls transaction status (the query stops on "completed"/"failed" and
 * unsubscribes on unmount), hands terminal results to the store once (idempotent,
 * guarded on the tracked tx), and returns the live status. No second poller runs
 * alongside it. Shared by PayInCardLive and SettlingCardLive.
 */
export function useSettlementWatcher<S extends string>(
  transactionId: string | null | undefined,
  initialStatus: S
): S {
  const { data } = useTransactionStatus(transactionId ?? null, {
    enabled: initialStatus !== "completed" && initialStatus !== "failed",
  })
  const resolveSettlement = useChatStore((s) => s.resolveSettlement)

  useEffect(() => {
    if (data && (data.status === "completed" || data.status === "failed")) {
      resolveSettlement(data)
    }
  }, [data, resolveSettlement])

  return (data?.status as S | undefined) ?? initialStatus
}
