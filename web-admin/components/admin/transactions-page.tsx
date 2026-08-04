"use client"

/**
 * TransactionsPage — the master-ledger oversight surface (design §6.8 `pTxns`).
 * Orchestrator: owns the view/search/keyset-cursor state; composes the view
 * tabs, the 7-column ledger (TxnLedger), and the cursor pager. This surface
 * never executes; it only reads (§3.1). Rows navigate to `/transactions/[id]`.
 */
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { useTransactions } from "@/lib/query/hooks"
import { TransactionViewTabs } from "@/components/admin/transactions/transaction-view-tabs"
import { TxnLedger } from "@/components/admin/transactions/txn-ledger"
import { CursorPaginator } from "@/components/admin/cursor-paginator"
import { SEARCH_DEBOUNCE_MS } from "@/constants/transactions"
import { buildQuery } from "@/lib/transactions/format"
import type { TransactionsView } from "@/types"

export function TransactionsPage() {
  const router = useRouter()
  const [view, setView] = useState<TransactionsView>("all")
  const [search, setSearch] = useState("")
  // Keyset cursor history: the stack's last entry is the current page's cursor
  // (`undefined` = first page). `nextCursor` from the response drives "Next".
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([
    undefined,
  ])

  // Debounce the free-text search before it hits the server-side `q` param (§7).
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search])

  const cursor = cursorStack[cursorStack.length - 1]
  const query = useMemo(
    () => buildQuery(view, debouncedSearch, cursor),
    [view, debouncedSearch, cursor]
  )
  const { data, isLoading, isError, isSuccess, refetch } =
    useTransactions(query)

  const rows = data?.items ?? []

  function selectView(next: TransactionsView) {
    setView(next)
    setCursorStack([undefined])
  }

  function onSearch(value: string) {
    setSearch(value)
    setCursorStack([undefined])
  }

  function goNext() {
    if (data?.nextCursor) setCursorStack((s) => [...s, data.nextCursor!])
  }

  function goPrev() {
    setCursorStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }

  return (
    <div className="mx-auto max-w-[1360px] px-[30px] pt-[26px] pb-[60px]">
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em]">
          Transactions
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Master ledger of activity across buy, sell, send, swap, receive &amp;
          ticket.
        </p>
      </div>

      <TransactionViewTabs
        view={view}
        counts={data?.counts}
        search={search}
        onSelectView={selectView}
        onSearch={onSearch}
      />

      <TxnLedger
        rows={rows}
        isLoading={isLoading}
        isError={isError}
        isSuccess={isSuccess}
        search={search}
        onRetry={() => void refetch()}
        onOpen={(id) => router.push(`/transactions/${id}`)}
      />

      {isSuccess && rows.length > 0 && (
        <CursorPaginator
          pageIndex={cursorStack.length}
          canPrev={cursorStack.length > 1}
          canNext={Boolean(data?.nextCursor)}
          onPrev={goPrev}
          onNext={goNext}
        />
      )}
    </div>
  )
}
