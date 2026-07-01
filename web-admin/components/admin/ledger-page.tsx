"use client"

/**
 * LedgerPage — the GLOBAL double-entry ledger viewer (design §6.11 Ledger), wired
 * to the real global cross-account read via `useGlobalLedger` (GET /admin/ledger/all)
 * plus the sequence-integrity summary via `useLedgerIntegrity` (GET /admin/ledger/integrity).
 *
 * Reproduces `docs/design-ref/screens/Ledger.html` 1:1: a header with a live
 * "Sequence integrity" pill, a filter row (account TYPE prefix · currency) with an
 * Export action, and the six-column table
 * (Seq · Account · Dir · Amount · Running · Source). The Source cell links to the
 * transaction's detail route (`/transactions/[id]`), exactly as the design's
 * `onSource` navigates to `txDetail`.
 *
 * Phase 6b: unlike the old account-scoped triple, this browses across ALL accounts
 * by account-TYPE prefix (or "All") + currency (or "All"), newest-first, with real
 * server-side keyset pagination — a "Load more" button pages beyond the first slice
 * via the response `nextCursor`. The header pill reflects the real global
 * gap/reorder check.
 *
 * Read-only (§3.1): nothing here moves money. Four async branches:
 * loading skeletons / error / empty / data. The Export button remains a toast
 * stand-in — its backend and the write path are a later phase.
 */
import { useMemo, useState } from "react"
import Link from "next/link"

import { FilterSelect } from "@/components/admin/filter-select"
import { Skeleton } from "@/components/ui/skeleton"
import { pushToast } from "@/lib/store/toast-store"
import { useGlobalLedger, useLedgerIntegrity } from "@/lib/query/hooks"
import type {
  AdminLedgerEntry,
  AdminLedgerListQuery,
} from "@handshake-agent/contracts"

// ── Filter axes ──────────────────────────────────────────────────────────────

/**
 * The account-TYPE filter (design's coarse prefix filter). "All" (empty value)
 * omits the `accountType` param → the endpoint browses every account type. The
 * non-empty values are the real `LedgerAccountType` enum (api `06-engine.prisma`).
 */
const ACCOUNT_OPTIONS = [
  { value: "", label: "All account types" },
  { value: "user_wallet", label: "User wallet" },
  { value: "platform_float", label: "Platform float" },
  { value: "processor_settlement", label: "Processor settlement" },
  { value: "treasury_reserve", label: "Treasury reserve" },
  { value: "clearing", label: "Clearing" },
  { value: "compensation", label: "Compensation" },
] as const

/** Currency axis — "All" (empty) omits the filter; else the launch currencies. */
const CURRENCY_OPTIONS = [
  { value: "", label: "All currencies" },
  { value: "NGN", label: "NGN" },
  { value: "USDT", label: "USDT" },
  { value: "TRX", label: "TRX" },
] as const

/** Server page size for each "Load more" fetch. */
const PAGE_SIZE = 25

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

/** Format a canonical decimal string per its OWN currency (each row is global). */
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

/** Project entries onto the design's row shape (newest-first, as returned). Each
 *  row formats against its OWN currency (this is a mixed-currency global view). */
function toRows(entries: readonly AdminLedgerEntry[]): LedgerRow[] {
  return entries.map((e) => ({
    key: e.id,
    seq: String(e.sequence),
    acct: `${e.accountType}:${e.accountId}:${e.currency}`,
    dir: e.direction.toUpperCase(),
    dirDanger: e.direction === "debit",
    amt: formatAmount(e.amount, e.currency),
    run: formatAmount(e.balanceAfter, e.currency),
    src: e.transactionId,
    href: e.transactionId ? `/transactions/${e.transactionId}` : null,
  }))
}

export function LedgerPage() {
  const [account, setAccount] = useState("")
  const [currency, setCurrency] = useState("")

  // Both filters are optional; empty → omit the param (global across that axis).
  const filters: AdminLedgerListQuery = useMemo(
    () => ({
      ...(account ? { accountType: account } : {}),
      ...(currency ? { currency } : {}),
      limit: PAGE_SIZE,
    }),
    [account, currency]
  )

  const ledger = useGlobalLedger(filters)
  const integrity = useLedgerIntegrity()

  const rows = useMemo(
    () => toRows(ledger.data?.pages.flatMap((p) => p.entries) ?? []),
    [ledger.data]
  )

  /** Export toast stand-in — mirrors the design's `exportLedger()` (logic.js 790). */
  function exportLedger() {
    pushToast("Exporting ledger to CSV…", "info")
  }

  // Header pill: reflects the real integrity summary (ok/broken), degrading to a
  // neutral "checking" label while the summary loads or if it errors.
  const integrityOk = integrity.data?.ok === true
  const integrityBroken = integrity.data?.ok === false
  const pillLabel = integrityBroken
    ? `Sequence gap: ${integrity.data?.brokenAccount ?? "unknown"}`
    : integrityOk
      ? "Sequence integrity OK"
      : "Checking integrity…"

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
        <div
          className={`flex h-[34px] items-center gap-[9px] rounded-full px-[13px] text-[11.5px] font-bold ${
            integrityBroken
              ? "bg-sdn text-tdn"
              : "bg-sok text-tok"
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d={integrityBroken ? "M12 9v4m0 4h.01" : "m5 12 5 5L20 7"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {pillLabel}
        </div>
      </div>

      {/* ── Filter row: account type · currency + Export ────────────────────── */}
      <div className="mb-[14px] flex flex-wrap gap-[10px]">
        <FilterSelect
          label="Filter by account type"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          options={ACCOUNT_OPTIONS}
        />
        <FilterSelect
          label="Filter by currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
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
        {ledger.isLoading && (
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
        {ledger.isError && (
          <div className="flex flex-col items-center gap-2.5 px-[18px] py-[50px] text-center">
            <p className="text-[13px] font-bold text-tdn">
              Couldn&apos;t load ledger entries
            </p>
            <button
              type="button"
              onClick={() => ledger.refetch()}
              className="flex h-[34px] items-center rounded-[10px] border border-line bg-card px-3.5 text-[12px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {!ledger.isLoading && !ledger.isError && rows.length === 0 && (
          <div className="px-[18px] py-[50px] text-center text-[13px] text-ink3">
            No ledger entries match these filters.
          </div>
        )}

        {/* Data */}
        {!ledger.isLoading &&
          !ledger.isError &&
          rows.map((row) => (
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

      {/* ── Keyset "Load more" (server-side cursor, newest-first) ────────────── */}
      {!ledger.isLoading && !ledger.isError && ledger.hasNextPage && (
        <div className="mt-[14px] flex justify-center">
          <button
            type="button"
            onClick={() => ledger.fetchNextPage()}
            disabled={ledger.isFetchingNextPage}
            className="flex h-[38px] items-center rounded-[11px] border border-line bg-card px-[16px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
          >
            {ledger.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  )
}
