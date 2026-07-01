"use client"

/**
 * LedgerPage — the double-entry ledger viewer (design §6.11 Ledger).
 *
 * Reproduces `docs/design-ref/screens/Ledger.html` 1:1: a header with a
 * "Sequence integrity OK" pill, a two-select filter row (account type · currency)
 * with an Export action, and the six-column table
 * (Seq · Account · Dir · Amount · Running · Source). The Source cell links to the
 * transaction's detail route (`/transactions/[id]`), exactly as the design's
 * `onSource` navigates to `txDetail`.
 *
 * This is a design reproduction, not a data-wired screen: the row set, running
 * balances, sequence numbers, and amount/currency formatting are all translated
 * verbatim from the design's `vLedger()` + `ngn()` logic (docs/design-ref/logic.js
 * lines 332, 791-817) and embedded as module-level mock data. Real-data
 * reintegration is a separate later step.
 */
import { useMemo, useState } from "react"
import Link from "next/link"

import { FilterSelect } from "@/components/admin/filter-select"
import { Pagination } from "@/components/admin/pagination"

// ── Design data (translated from vLedger(), logic.js 791-817) ────────────────

/** One raw ledger leg from the design's `base` array (logic.js 794-805). */
interface LedgerLeg {
  acct: string
  dir: "DEBIT" | "CREDIT"
  raw: number
  ccy: "NGN" | "USDT" | "TRX"
  src: string
}

/** The design's `base` legs, verbatim. */
const BASE_LEGS: readonly LedgerLeg[] = [
  {
    acct: "user:usr_10480:NGN",
    dir: "DEBIT",
    raw: 106469,
    ccy: "NGN",
    src: "tx_80231",
  },
  {
    acct: "treasury:USDT",
    dir: "DEBIT",
    raw: 100,
    ccy: "USDT",
    src: "tx_80231",
  },
  {
    acct: "user:usr_10480:USDT",
    dir: "CREDIT",
    raw: 100,
    ccy: "USDT",
    src: "tx_80231",
  },
  {
    acct: "revenue:fees:NGN",
    dir: "CREDIT",
    raw: 1178,
    ccy: "NGN",
    src: "tx_80231",
  },
  {
    acct: "user:usr_10487:NGN",
    dir: "CREDIT",
    raw: 53200,
    ccy: "NGN",
    src: "tx_80244",
  },
  { acct: "float:NGN", dir: "DEBIT", raw: 53200, ccy: "NGN", src: "tx_80244" },
  {
    acct: "user:usr_10501:USDT",
    dir: "DEBIT",
    raw: 50,
    ccy: "USDT",
    src: "tx_80257",
  },
  {
    acct: "treasury:USDT",
    dir: "CREDIT",
    raw: 50,
    ccy: "USDT",
    src: "tx_80257",
  },
  {
    acct: "revenue:spread:NGN",
    dir: "CREDIT",
    raw: 905,
    ccy: "NGN",
    src: "tx_80231",
  },
  { acct: "float:TRX", dir: "DEBIT", raw: 42.4, ccy: "TRX", src: "sweep_221" },
]

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

/** Format an absolute amount per its currency, as the design's inner `fmt`/amt do. */
function formatAmount(value: number, ccy: LedgerLeg["ccy"]): string {
  if (ccy === "NGN") return ngn(Math.abs(value))
  return Math.abs(value).toFixed(ccy === "TRX" ? 4 : 6) + " " + ccy
}

/** A derived, display-ready ledger row (mirrors vLedger()'s returned row shape). */
interface LedgerRow {
  seq: string
  acct: string
  dir: LedgerLeg["dir"]
  dirDanger: boolean
  amt: string
  run: string
  src: string
  /** The tx-detail route, or null for non-tx sources (e.g. sweeps) — no link then. */
  href: string | null
}

/** The design's two filter axes (logic.js 806-816). */
type AccountFilter = "all" | "user" | "treasury" | "revenue" | "float"
type CurrencyFilter = "all" | "NGN" | "USDT" | "TRX"

const ACCOUNT_OPTIONS = [
  { value: "all", label: "All accounts" },
  { value: "user", label: "User" },
  { value: "treasury", label: "Treasury" },
  { value: "revenue", label: "Fees / revenue" },
  { value: "float", label: "Float" },
] as const

const CURRENCY_OPTIONS = [
  { value: "all", label: "All currencies" },
  { value: "NGN", label: "NGN" },
  { value: "USDT", label: "USDT" },
  { value: "TRX", label: "TRX" },
] as const

/**
 * Build the filtered, running-balance-carrying rows, exactly as vLedger() does:
 * filter by account prefix + currency, then reduce a per-currency running total
 * (CREDIT adds, DEBIT subtracts), formatting each amount/running per currency.
 */
function buildRows(acct: AccountFilter, ccy: CurrencyFilter): LedgerRow[] {
  const run: Record<string, number> = {}
  return BASE_LEGS.filter((leg) => {
    if (acct !== "all" && !leg.acct.startsWith(acct)) return false
    if (ccy !== "all" && leg.ccy !== ccy) return false
    return true
  }).map((leg, i) => {
    run[leg.ccy] =
      (run[leg.ccy] ?? 0) + (leg.dir === "CREDIT" ? leg.raw : -leg.raw)
    return {
      seq: "44" + (920 + i),
      acct: leg.acct,
      dir: leg.dir,
      dirDanger: leg.dir === "DEBIT",
      amt: formatAmount(leg.raw, leg.ccy),
      run: formatAmount(run[leg.ccy], leg.ccy),
      src: leg.src,
      href: leg.src.startsWith("tx") ? `/transactions/${leg.src}` : null,
    }
  })
}

/** Six-column grid (Seq · Account · Dir · Amount · Running · Source), shared by
 *  the header and every body row so the columns stay aligned. */
const LEDGER_GRID =
  "grid grid-cols-[0.7fr_1.8fr_0.8fr_1.1fr_1.1fr_1fr] gap-3 px-[18px]"

const PAGE_SIZE = 6

export function LedgerPage() {
  const [account, setAccount] = useState<AccountFilter>("all")
  const [currency, setCurrency] = useState<CurrencyFilter>("all")
  const [page, setPage] = useState(1)

  const rows = useMemo(() => buildRows(account, currency), [account, currency])
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  /** Export toast stand-in — mirrors the design's `exportLedger()` (logic.js 790). */
  function exportLedger() {
    // Design shows a "Exporting ledger to CSV…" toast; reproduction is presentation-only.
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

      {/* ── Filter row: account · currency selects + Export ─────────────────── */}
      <div className="mb-[14px] flex flex-wrap gap-[10px]">
        <FilterSelect
          label="Filter by account"
          value={account}
          onChange={(e) => {
            setAccount(e.target.value as AccountFilter)
            setPage(1)
          }}
          options={ACCOUNT_OPTIONS}
        />
        <FilterSelect
          label="Filter by currency"
          value={currency}
          onChange={(e) => {
            setCurrency(e.target.value as CurrencyFilter)
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
        {/* Body rows */}
        {pageRows.map((row) => (
          <div
            key={row.seq}
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

      {/* ── Pagination (shared, page size 6) ────────────────────────────────── */}
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
