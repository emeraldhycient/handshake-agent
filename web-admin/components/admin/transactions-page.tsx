"use client"

/**
 * TransactionsPage — the deterministic-engine oversight surface (Phase 3, A/B).
 * Status / type / userId filters drive a keyed `useTransactions(query)`; results
 * render in a cursor-paginated table (id / type / user / status / created).
 * Clicking a row opens the `TransactionDetail` drawer with the full aggregate and
 * the triage actions (Mark failed / Retry).
 *
 * Cursor pagination: "Next" pushes the response's `nextCursor`; a back-stack of
 * cursors powers "Previous". Changing a filter resets paging.
 *
 * Four async branches on the transactions query: loading / error / empty / data.
 */
import { useMemo, useState } from "react"
import {
  AdminTxnStatusSchema,
  type AdminTxnSearchQuery,
  type AdminTxnStatus,
} from "@handshake-agent/contracts"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { TransactionStatusBadge } from "@/components/admin/transaction-status-badge"
import { TransactionDetail } from "@/components/admin/transaction-detail"
import { useTransactions } from "@/lib/query/hooks"

const STATUSES = AdminTxnStatusSchema.options
const PAGE_LIMIT = 25

// Engine statuses still in flight — rendered with a pulsing pill dot (design §5).
const STUCK_STATUSES = new Set<AdminTxnStatus>([
  "pending",
  "validating",
  "settling",
])

// Type → 24×24 stroke-icon path (design typeIcon map, line 2057). Unknown types
// fall back to the buy glyph so every row still gets a type mark.
const TYPE_ICON: Record<string, string> = {
  buy: "M4 8h13l-3-3",
  sell: "M20 16H7l3 3",
  send: "M4 12h13l-4-4M4 12l9 5",
  swap: "M8 7h11l-3-3M16 17H5l3 3",
  receive: "M12 4v13l-4-4",
  ticket: "M4 9h16v6H4z",
  refund: "M4 12a8 8 0 1 1 2.3 5.6",
}

function typeIconPath(type: string): string {
  return TYPE_ICON[type] ?? TYPE_ICON.buy
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function TransactionsPage() {
  const [status, setStatus] = useState("")
  const [type, setType] = useState("")
  const [userId, setUserId] = useState("")
  const [cursors, setCursors] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const cursor = cursors[cursors.length - 1]
  const params = useMemo<AdminTxnSearchQuery>(
    () => ({
      ...(status ? { status: status as AdminTxnSearchQuery["status"] } : {}),
      ...(type.trim() ? { type: type.trim() } : {}),
      ...(userId.trim() ? { userId: userId.trim() } : {}),
      ...(cursor ? { cursor } : {}),
      limit: PAGE_LIMIT,
    }),
    [status, type, userId, cursor]
  )

  const txnQuery = useTransactions(params)

  function resetPaging() {
    setCursors([])
  }

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col gap-4 overflow-y-auto px-[30px] py-[26px] pb-[60px]">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
          Transactions
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Master ledger of activity across buy, sell, send, swap, receive &amp;
          ticket.
        </p>
      </div>

      {/* ── Filter toolbar ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="txn-status">Status</Label>
          <NativeSelect
            id="txn-status"
            className="w-44"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              resetPaging()
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="txn-type">Type</Label>
          <Input
            id="txn-type"
            className="w-40"
            value={type}
            onChange={(e) => {
              setType(e.target.value)
              resetPaging()
            }}
            placeholder="e.g. buy / sell"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="txn-user">User id</Label>
          <Input
            id="txn-user"
            className="w-64"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value)
              resetPaging()
            }}
            placeholder="User UUID"
          />
        </div>
      </div>

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {txnQuery.isLoading && (
        <div
          className="overflow-hidden rounded-2xl border border-line bg-card"
          aria-busy="true"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-line2 px-[18px] py-3.5 last:border-b-0"
            >
              <Skeleton className="h-4 w-28 rounded-md" />
              <Skeleton className="h-6 w-6 rounded-[7px]" />
              <Skeleton className="h-4 flex-1 rounded-md" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-32 rounded-md" />
            </div>
          ))}
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {txnQuery.isError && (
        <div className="rounded-2xl border border-sdn bg-sdn/40 p-5 text-center">
          <p className="text-[13px] font-bold text-tdn">
            Failed to load transactions
          </p>
          <p className="mt-1 text-[12.5px] text-ink3">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {txnQuery.isSuccess && txnQuery.data.items.length === 0 && (
        <div className="rounded-2xl border border-line bg-card px-[18px] py-[50px] text-center text-[13px] text-ink3">
          No transactions match these filters.
        </div>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {txnQuery.isSuccess && txnQuery.data.items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-2xl border border-line bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txnQuery.data.items.map((txn) => {
                  const stuck = STUCK_STATUSES.has(txn.status)
                  return (
                    <TableRow
                      key={txn.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open transaction ${txn.id}`}
                      className="cursor-pointer focus-visible:bg-hov focus-visible:outline-none"
                      onClick={() => setSelectedId(txn.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          setSelectedId(txn.id)
                        }
                      }}
                    >
                      <TableCell className="font-mono text-[12px] font-bold text-tif">
                        {txn.id.slice(0, 8)}…
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-[7px]">
                          <span className="flex size-6 flex-none items-center justify-center rounded-[7px] bg-card2 text-ink2">
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d={typeIconPath(txn.type)}
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span className="text-[12px] font-semibold text-ink capitalize">
                            {txn.type}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate font-mono text-[12px] text-ink2">
                        {txn.userId.slice(0, 8)}…
                      </TableCell>
                      <TableCell>
                        <TransactionStatusBadge
                          status={txn.status}
                          stuck={stuck}
                        />
                      </TableCell>
                      <TableCell className="text-[11.5px] text-ink2 tabular-nums">
                        {formatDate(txn.createdAt)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* ── Cursor pagination ──────────────────────────────────────── */}
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={cursors.length === 0}
              onClick={() => setCursors((prev) => prev.slice(0, -1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!txnQuery.data.nextCursor}
              onClick={() =>
                setCursors((prev) =>
                  txnQuery.data.nextCursor
                    ? [...prev, txnQuery.data.nextCursor]
                    : prev
                )
              }
            >
              Next
            </Button>
          </div>
        </>
      )}

      <TransactionDetail
        transactionId={selectedId}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      />
    </div>
  )
}
