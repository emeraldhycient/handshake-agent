"use client"

/**
 * LedgerPage — the double-entry ledger oversight surface (Phase 3, sub-area A).
 *
 * Top: an account picker — accountType (select) + accountId + currency — that,
 * once all three are set, drives `useLedgerHistory` and renders the account's
 * posted entries (sequence / dir / amount / balanceAfter / postedAt).
 *
 * Bottom: a "Verify transaction integrity" input (a transaction id) + button that
 * re-sums that transaction's legs server-side (read-only, §3.1) and shows the
 * {balanced, legCount, brokenAt} result as a success / danger panel.
 *
 * Four async branches on the history query: loading / error / empty / data. The
 * account-type list is a local presentation tuple (mirrors the engine enum).
 */
import { useMemo, useState } from "react"

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
import { useLedgerHistory, useVerifyLedger } from "@/lib/query/hooks"
import type { LedgerHistoryQuery } from "@/lib/api/ledger"
import { ApiError } from "@/lib/api/client"

// The LedgerAccountType engine enum (presentation labels for the picker).
const ACCOUNT_TYPES = [
  "user_wallet",
  "platform_float",
  "processor_settlement",
  "treasury_reserve",
  "clearing",
  "compensation",
] as const

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

export function LedgerPage() {
  const [accountType, setAccountType] = useState<string>(ACCOUNT_TYPES[0])
  const [accountId, setAccountId] = useState("")
  const [currency, setCurrency] = useState("")
  const [verifyId, setVerifyId] = useState("")

  const query = useMemo<LedgerHistoryQuery | null>(() => {
    if (!accountType || !accountId.trim() || !currency.trim()) return null
    return {
      accountType,
      accountId: accountId.trim(),
      currency: currency.trim(),
    }
  }, [accountType, accountId, currency])

  const history = useLedgerHistory(query)
  const verify = useVerifyLedger()

  function onVerify() {
    if (verifyId.trim().length === 0) return
    verify.mutate(verifyId.trim())
  }

  const verifyError = errorMessage(verify.error)

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-extrabold tracking-tight text-foreground">
          Ledger
        </h1>
      </div>

      {/* ── Account picker ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-[14px] border border-border bg-card p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ledger-account-type">Account type</Label>
          <NativeSelect
            id="ledger-account-type"
            className="w-52"
            value={accountType}
            onChange={(e) => setAccountType(e.target.value)}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ledger-account-id">Account id</Label>
          <Input
            id="ledger-account-id"
            className="w-64"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="walletId or named ref"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ledger-currency">Currency</Label>
          <Input
            id="ledger-currency"
            className="w-32"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder="USDT"
          />
        </div>
      </div>

      {/* ── History: prompt / loading / error / empty / data ─────────────── */}
      {query === null && (
        <p className="text-sm text-muted-foreground">
          Enter an account type, account id, and currency to load its ledger.
        </p>
      )}

      {query !== null && history.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      )}

      {query !== null && history.isError && (
        <div className="rounded-[14px] border border-destructive/20 bg-destructive/5 p-5 text-center">
          <p className="text-sm font-semibold text-destructive">
            Failed to load ledger history
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Check the account triple and try again.
          </p>
        </div>
      )}

      {query !== null &&
        history.isSuccess &&
        history.data.entries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No ledger entries for this account.
          </p>
        )}

      {query !== null &&
        history.isSuccess &&
        history.data.entries.length > 0 && (
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Seq</TableHead>
                  <TableHead>Dir</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance after</TableHead>
                  <TableHead>Posted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data.entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="tabular-nums">
                      {entry.sequence}
                    </TableCell>
                    <TableCell className="text-xs">
                      {entry.direction === "debit" ? "− debit" : "+ credit"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.amount} {entry.currency}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {entry.balanceAfter}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatDate(entry.postedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

      {/* ── Integrity verify ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4">
        <h2 className="text-sm font-bold text-foreground">
          Verify transaction integrity
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ledger-verify-id">Transaction id</Label>
            <Input
              id="ledger-verify-id"
              className="w-72"
              value={verifyId}
              onChange={(e) => setVerifyId(e.target.value)}
              placeholder="Transaction UUID"
            />
          </div>
          <Button
            size="sm"
            disabled={verify.isPending || verifyId.trim().length === 0}
            aria-busy={verify.isPending}
            onClick={onVerify}
          >
            {verify.isPending ? "Verifying…" : "Verify"}
          </Button>
        </div>

        {verifyError && (
          <p role="alert" className="text-xs text-destructive">
            {verifyError}
          </p>
        )}

        {verify.isSuccess && (
          <div
            role="status"
            className={
              verify.data.balanced
                ? "rounded-md border border-success/30 bg-success/5 px-4 py-3 text-sm text-success-foreground"
                : "rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            }
          >
            <p className="font-semibold">
              {verify.data.balanced ? "Balanced" : "Imbalanced"}
            </p>
            <p className="mt-1 text-xs">
              {verify.data.legCount} leg
              {verify.data.legCount === 1 ? "" : "s"}
              {verify.data.brokenAt
                ? ` · breaks at ${verify.data.brokenAt}`
                : " · all currencies net to zero"}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
