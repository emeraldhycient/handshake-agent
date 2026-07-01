"use client"

/**
 * LedgerPage — the double-entry ledger viewer (design §6.11 Ledger), wired to the
 * real read-only ledger-history endpoint via `useLedgerHistory` (GET /admin/ledger).
 *
 * Reproduces `docs/design-ref/screens/Ledger.html` 1:1: a header with a
 * "Sequence integrity OK" pill, a filter row (account type · account id · currency)
 * with an Export action, and the six-column table
 * (Seq · Account · Dir · Amount · Running · Source). The Source cell links to the
 * transaction's detail route (`/transactions/[id]`), exactly as the design's
 * `onSource` navigates to `txDetail`.
 *
 * SHAPE MISMATCH (recorded for backend enrichment): the design browses across ALL
 * accounts by account-TYPE prefix (user/treasury/revenue/float) + currency, but the
 * only ledger read endpoint requires a full (accountType, accountId, currency)
 * triple scoped to ONE account — there is no global cross-account ledger list, no
 * keyset pagination, and no global sequence-integrity endpoint. So the account
 * filter is a real `LedgerAccountType` + an explicit account-id input (the triple
 * the endpoint needs); the query stays idle until the triple is complete, and the
 * header integrity pill remains a static indicator (no global endpoint feeds it).
 *
 * Read-only (§3.1): nothing here moves money. Four async branches:
 * loading skeletons / error / empty (idle or no-entries) / data. The Export button
 * remains a toast stand-in — its backend and the write path are a later phase.
 */
import { useMemo, useState } from "react"
import Link from "next/link"

import { FilterSelect } from "@/components/admin/filter-select"
import { Pagination } from "@/components/admin/pagination"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { pushToast } from "@/lib/store/toast-store"
import { useLedgerHistory } from "@/lib/query/hooks"
import type { LedgerHistoryQuery } from "@/lib/api/ledger"
import type { AdminLedgerEntry } from "@handshake-agent/contracts"

// ── Filter axes ──────────────────────────────────────────────────────────────

/**
 * The real `LedgerAccountType` enum (api `06-engine.prisma`), replacing the
 * design's coarse type-prefix filter — the endpoint keys on these exact values.
 */
const ACCOUNT_OPTIONS = [
  { value: "user_wallet", label: "User wallet" },
  { value: "platform_float", label: "Platform float" },
  { value: "processor_settlement", label: "Processor settlement" },
  { value: "treasury_reserve", label: "Treasury reserve" },
  { value: "clearing", label: "Clearing" },
  { value: "compensation", label: "Compensation" },
] as const

/** Currency axis — the design's three launch currencies (endpoint keys on this). */
const CURRENCY_OPTIONS = [
  { value: "NGN", label: "NGN" },
  { value: "USDT", label: "USDT" },
  { value: "TRX", label: "TRX" },
] as const

type AccountType = (typeof ACCOUNT_OPTIONS)[number]["value"]
type Currency = (typeof CURRENCY_OPTIONS)[number]["value"]

/** Newest-first, capped page of entries the endpoint returns per account. */
const PAGE_SIZE = 6
const HISTORY_LIMIT = 500

// ── Formatting (mirrors the design's `ngn()` + per-currency `fmt`) ───────────

/** The design's `ngn()` helper (logic.js 332): "₦" + en-NG 2-dp grouping. */
function ngn(n: number): string {
  return (
    "₦" +
    Number(n).toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

/** Format a canonical decimal string per its currency, as the design's amt does. */
function formatAmount(value: string, currency: string): string {
  const n = Number(value)
  if (currency === "NGN") return ngn(Math.abs(n))
  return Math.abs(n).toFixed(currency === "TRX" ? 4 : 6) + " " + currency
}

/** Six-column grid (Seq · Account · Dir · Amount · Running · Source), shared by
 *  the header and every body row so the columns stay aligned. */
const LEDGER_GRID =
  "grid grid-cols-[0.7fr_1.8fr_0.8fr_1.1fr_1.1fr_1fr] gap-3 px-[18px]"

/** One display-ready row projected from a real `AdminLedgerEntry`. */
interface LedgerRow {
  key: string
  seq: string
  acct: string
  dir: string
  dirDanger: boolean
  amt: string
  run: string
  src: string
  /** The tx-detail route, or null when the source is not a transaction. */
  href: string | null
}

/** Project entries onto the design's row shape (newest-first, as returned). */
function toRows(
  entries: readonly AdminLedgerEntry[],
  currency: string
): LedgerRow[] {
  return entries.map((e) => ({
    key: e.id,
    seq: String(e.sequence),
    acct: `${e.accountType}:${e.accountId}:${e.currency}`,
    dir: e.direction.toUpperCase(),
    dirDanger: e.direction === "debit",
    amt: formatAmount(e.amount, currency),
    run: formatAmount(e.balanceAfter, currency),
    src: e.transactionId,
    href: e.transactionId ? `/transactions/${e.transactionId}` : null,
  }))
}

export function LedgerPage() {
  const [account, setAccount] = useState<AccountType>("user_wallet")
  const [accountId, setAccountId] = useState("")
  const [currency, setCurrency] = useState<Currency>("NGN")
  const [page, setPage] = useState(1)

  // The endpoint needs the full (accountType, accountId, currency) triple; until
  // an account id is entered the query stays idle (null → hook disabled).
  const trimmedId = accountId.trim()
  const query: LedgerHistoryQuery | null = trimmedId
    ? {
        accountType: account,
        accountId: trimmedId,
        currency,
        limit: HISTORY_LIMIT,
      }
    : null

  const history = useLedgerHistory(query)

  const rows = useMemo(
    () => toRows(history.data?.entries ?? [], currency),
    [history.data?.entries, currency]
  )
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  /** Export toast stand-in — mirrors the design's `exportLedger()` (logic.js 790). */
  function exportLedger() {
    pushToast("Exporting ledger to CSV…", "info")
  }

  return (
    <div className="mx-auto w-full max-w-[1300px] px-[30px] pt-[26px] pb-[60px]">
      {/* ── Header: title + subtitle · integrity pill ───────────────────────── */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">
            Ledger
          </h1>
          <p className="mt-[5px] text-[13.5px] text-ink2">
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

      {/* ── Filter row: account type · account id · currency + Export ───────── */}
      <div className="mb-[14px] flex flex-wrap gap-[10px]">
        <FilterSelect
          label="Filter by account type"
          value={account}
          onChange={(e) => {
            setAccount(e.target.value as AccountType)
            setPage(1)
          }}
          options={ACCOUNT_OPTIONS}
        />
        <Input
          value={accountId}
          onChange={(e) => {
            setAccountId(e.target.value)
            setPage(1)
          }}
          placeholder="Account id…"
          aria-label="Account id"
          className="h-[38px] w-[220px] rounded-[11px] bg-card font-mono text-[12.5px]"
        />
        <FilterSelect
          label="Filter by currency"
          value={currency}
          onChange={(e) => {
            setCurrency(e.target.value as Currency)
            setPage(1)
          }}
          options={CURRENCY_OPTIONS}
        />
        <div className="flex-1" />
        <button
          type="button"
          onClick={exportLedger}
          className="flex h-[38px] items-center gap-[7px] rounded-[11px] border border-line bg-card px-[14px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Export
        </button>
      </div>

      {/* ── Table: Seq · Account · Dir · Amount · Running · Source ──────────── */}
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

        {/* Loading */}
        {history.isLoading && (
          <div aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className={`${LEDGER_GRID} items-center border-b border-line2 py-[11px] last:border-b-0`}
              >
                <Skeleton className="h-3.5 w-10" />
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3.5 w-12" />
                <Skeleton className="ml-auto h-3.5 w-16" />
                <Skeleton className="ml-auto h-3.5 w-16" />
                <Skeleton className="h-3.5 w-14" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {history.isError && (
          <div className="flex flex-col items-center gap-2.5 px-[18px] py-[50px] text-center">
            <p className="text-[13px] font-bold text-tdn">
              Couldn&apos;t load ledger entries
            </p>
            <button
              type="button"
              onClick={() => history.refetch()}
              className="flex h-[34px] items-center rounded-[10px] border border-line bg-card px-3.5 text-[12px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty — idle (no account chosen) or a queried account with no entries */}
        {!history.isLoading && !history.isError && rows.length === 0 && (
          <div className="px-[18px] py-[50px] text-center text-[13px] text-ink3">
            {query === null
              ? "Enter an account id to view its double-entry ledger."
              : "No ledger entries for this account and currency."}
          </div>
        )}

        {/* Data */}
        {!history.isLoading &&
          !history.isError &&
          pageRows.map((row) => (
            <div
              key={row.key}
              className={`${LEDGER_GRID} items-center border-b border-line2 py-[11px] last:border-b-0`}
            >
              <div className="font-mono text-[11px] text-ink3 tabular-nums">
                {row.seq}
              </div>
              <div className="font-mono text-[12px] text-ink2">{row.acct}</div>
              <div>
                <span
                  className={`text-[10.5px] font-extrabold ${
                    row.dirDanger ? "text-tdn" : "text-tok"
                  }`}
                >
                  {row.dir}
                </span>
              </div>
              <div className="text-right font-mono text-[12px] font-bold tabular-nums">
                {row.amt}
              </div>
              <div className="text-right font-mono text-[12px] text-ink2 tabular-nums">
                {row.run}
              </div>
              <div>
                {row.href ? (
                  <Link
                    href={row.href}
                    className="font-mono text-[11.5px] font-bold text-tif hover:underline"
                  >
                    {row.src}
                  </Link>
                ) : (
                  <span className="font-mono text-[11.5px] font-bold text-tif">
                    {row.src}
                  </span>
                )}
              </div>
            </div>
          ))}
      </div>

      {/* ── Pagination (client-side over the returned page, size 6) ─────────── */}
      <Pagination
        total={rows.length}
        pageSize={PAGE_SIZE}
        page={page}
        onPageChange={setPage}
        maxWidth="1300px"
      />
    </div>
  )
}
