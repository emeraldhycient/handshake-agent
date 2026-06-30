"use client"

/**
 * TransactionsPage — the deterministic-engine oversight surface (Phase 3, A/B).
 * Status / type / userId filters drive a keyed `useTransactions(query)`; results
 * render in a cursor-paginated table (id / user / type / status / created).
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
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Transactions
        </h1>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-border bg-card p-4">
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
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {txnQuery.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load transactions
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Please refresh the page.
          </p>
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {txnQuery.isSuccess && txnQuery.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No transactions match these filters.
        </p>
      )}

      {/* ── Data ─────────────────────────────────────────────────────────── */}
      {txnQuery.isSuccess && txnQuery.data.items.length > 0 && (
        <>
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txnQuery.data.items.map((txn) => (
                  <TableRow
                    key={txn.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open transaction ${txn.id}`}
                    className="cursor-pointer focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => setSelectedId(txn.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        setSelectedId(txn.id)
                      }
                    }}
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {txn.id.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {txn.userId.slice(0, 8)}…
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {txn.type}
                    </TableCell>
                    <TableCell>
                      <TransactionStatusBadge status={txn.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatDate(txn.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
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
