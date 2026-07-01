"use client"

/**
 * LedgerPage — the double-entry ledger oversight surface (Phase 3, sub-area A).
 *
 * Top: an account picker — accountType (select) + accountId + currency — that,
 * once all three are set, drives `useLedgerHistory` and renders the account's
 * posted entries (seq / account / dir / amount / running / source).
 *
 * Bottom: a "Verify transaction integrity" input (a transaction id) + button that
 * re-sums that transaction's legs server-side (read-only, §3.1) and shows the
 * {balanced, legCount, brokenAt} result as a success / danger panel.
 *
 * Four async branches on the history query: loading / error / empty / data. The
 * account-type list is a local presentation tuple (mirrors the engine enum).
 */
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { useLedgerHistory, useVerifyLedger } from "@/lib/query/hooks"
import type { LedgerHistoryQuery } from "@/lib/api/ledger"
import type { AdminLedgerEntry } from "@handshake-agent/contracts"
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

// Ledger table grid — 6 columns matching the design (Seq / Account / Dir /
// Amount / Running / Source). Shared by the header row and every body row.
const LEDGER_GRID =
  "grid grid-cols-[0.7fr_1.8fr_0.8fr_1.1fr_1.1fr_1fr] items-center gap-3 px-[18px]"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

/** Build + download a CSV of the currently-loaded entries (client-side only). */
function exportEntries(entries: readonly AdminLedgerEntry[]): void {
  const header =
    "sequence,account,direction,amount,currency,balanceAfter,transactionId,postedAt"
  const rows = entries.map((e) =>
    [
      e.sequence,
      e.accountId,
      e.direction,
      e.amount,
      e.currency,
      e.balanceAfter,
      e.transactionId,
      e.postedAt,
    ].join(",")
  )
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "ledger-entries.csv"
  link.click()
  URL.revokeObjectURL(url)
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
  const entries = history.data?.entries ?? []
  const hasEntries = history.isSuccess && entries.length > 0

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-1 flex-col gap-4 overflow-y-auto px-[30px] py-[26px]">
      {/* ── Header + integrity pill ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Ledger
          </h1>
          <p className="mt-1 text-[13.5px] text-ink2">
            Double-entry viewer · per-(account, currency) sequence,
            advisory-locked.
          </p>
        </div>
        <div className="flex h-[34px] items-center gap-[9px] rounded-full bg-sok px-[13px] text-[11.5px] font-bold text-tok">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="m5 12 5 5L20 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Sequence integrity OK
        </div>
      </div>

      {/* ── Account picker + Export ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded-[16px] border border-line bg-card p-4">
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
        <div className="flex-1" />
        <Button
          variant="outline"
          size="lg"
          disabled={!hasEntries}
          onClick={() => exportEntries(entries)}
        >
          Export
        </Button>
      </div>

      {/* ── History: prompt / loading / error / empty / data ─────────────── */}
      {query === null && (
        <p className="text-[13px] text-ink2">
          Enter an account type, account id, and currency to load its ledger.
        </p>
      )}

      {query !== null && history.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      )}

      {query !== null && history.isError && (
        <div className="rounded-[16px] border border-sdn bg-sdn/40 p-5 text-center">
          <p className="text-[13px] font-bold text-tdn">
            Failed to load ledger history
          </p>
          <p className="mt-1 text-[12px] text-ink3">
            Check the account triple and try again.
          </p>
        </div>
      )}

      {query !== null && history.isSuccess && entries.length === 0 && (
        <div className="rounded-[16px] border border-line bg-card p-8 text-center">
          <p className="text-[14px] font-bold text-ink">No ledger entries</p>
          <p className="mt-1 text-[12.5px] text-ink3">
            This account has no posted entries.
          </p>
        </div>
      )}

      {query !== null && hasEntries && (
        <div className="overflow-hidden rounded-[16px] border border-line bg-card">
          {/* Header row */}
          <div
            className={`${LEDGER_GRID} border-b border-line bg-card2 py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase`}
          >
            <div>Seq</div>
            <div>Account</div>
            <div>Dir</div>
            <div className="text-right">Amount</div>
            <div className="text-right">Running</div>
            <div>Source</div>
          </div>
          {/* Body rows */}
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`${LEDGER_GRID} border-b border-line2 py-[11px] last:border-0`}
            >
              <div className="font-mono text-[11px] text-ink3 tabular-nums">
                {entry.sequence}
              </div>
              <div className="truncate font-mono text-[12px] text-ink2">
                {entry.accountId}
              </div>
              <div>
                <span
                  className={`text-[10.5px] font-extrabold ${
                    entry.direction === "debit" ? "text-tdn" : "text-tok"
                  }`}
                >
                  {entry.direction === "debit" ? "− debit" : "+ credit"}
                </span>
              </div>
              <div className="text-right font-mono text-[12px] font-bold text-ink tabular-nums">
                {entry.amount} {entry.currency}
              </div>
              <div className="text-right font-mono text-[12px] text-ink2 tabular-nums">
                {entry.balanceAfter}
              </div>
              <div
                className="truncate font-mono text-[11.5px] font-bold text-tif"
                title={`${entry.transactionId} · posted ${formatDate(entry.postedAt)}`}
              >
                {entry.transactionId}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Integrity verify ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-[16px] border border-line bg-card p-5">
        <div>
          <h2 className="text-[13px] font-extrabold text-ink">
            Verify transaction integrity
          </h2>
          <p className="mt-1 text-[12px] text-ink3">
            Re-sums a transaction&apos;s legs server-side · read-only, never
            mutates.
          </p>
        </div>
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
            size="lg"
            disabled={verify.isPending || verifyId.trim().length === 0}
            aria-busy={verify.isPending}
            onClick={onVerify}
          >
            {verify.isPending ? "Verifying…" : "Verify"}
          </Button>
        </div>

        {verifyError && (
          <p role="alert" className="text-[12px] text-tdn">
            {verifyError}
          </p>
        )}

        {verify.isSuccess && (
          <div
            role="status"
            className={
              verify.data.balanced
                ? "rounded-[10px] border border-sok bg-sok/50 px-4 py-3 text-[13px] text-tok"
                : "rounded-[10px] border border-sdn bg-sdn/50 px-4 py-3 text-[13px] text-tdn"
            }
          >
            <p className="font-bold">
              {verify.data.balanced ? "Balanced" : "Imbalanced"}
            </p>
            <p className="mt-1 text-[12px]">
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
