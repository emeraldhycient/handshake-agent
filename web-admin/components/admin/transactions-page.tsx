"use client"

/**
 * TransactionsPage — the master-ledger oversight surface (design §6.8 `pTxns`).
 *
 * PIXEL-FAITHFUL reproduction of `docs/design-ref/screens/Txns.html`: the header +
 * subtitle, the four view tabs (`txViews`) with count pills, an id/hash/ref search
 * pill, and the 7-column ledger table (ID / Type / User / Amount / Status /
 * Idempotency key / Created) with a pulsing-dot status pill on stuck rows. The data
 * is the design's OWN mock content — the `seed()` + `vTxns()` logic from
 * `docs/design-ref/logic.js` is translated verbatim into the module-level `TXNS`
 * const below (no fetching; real-data reintegration is a later step).
 *
 * Rows navigate to the detail route (`/transactions/[id]`). The design has no
 * money-moving actions on the list itself (triage lives on the detail page), but the
 * shared flow modals are composed here so the surface stays wired to the same
 * destinations as the design (§3.1: this list never executes — it proposes).
 */
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/admin/status-pill"
import { Pagination } from "@/components/admin/pagination"
import type { StatusPillStatus } from "@/types/components"

// ─── Design mock data (translated from docs/design-ref/logic.js seed() + vTxns()) ───

/** Nigerian-naira formatter — logic.js `ngn(n)` (line 332). */
function ngn(n: number): string {
  return (
    "₦" +
    Number(n).toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}

/** Deterministic PRNG — logic.js `rnd(s)` (line 9). */
function rnd(s: number): number {
  const x = Math.sin(s) * 10000
  return x - Math.floor(x)
}

/** The design's transaction status values (a subset of `stMeta` keys). */
type TxnStatus =
  | "settled"
  | "pending_settlement"
  | "failed"
  | "refunded"
  | "quoted"
  | "initiated"
  | "receive"

/** The design's transaction type values (`types`, logic.js line 44). */
type TxnType = "buy" | "sell" | "send" | "swap" | "receive" | "ticket"

interface MockTxn {
  id: string
  type: TxnType
  user: string
  userId: string
  asset: string
  usdt: number
  ngn: number
  rate: number
  status: TxnStatus
  flwRef: string
  chainHash: string
  idem: string
  created: string
}

// Operator names — logic.js first/last name pools (lines 10-11); users are built with
// name = F[i] + ' ' + L[i], so the tx `user` column reads e.g. "Amara Okeke".
const F = [
  "Amara",
  "Chidi",
  "Ngozi",
  "Emeka",
  "Ifeoma",
  "Tunde",
  "Bola",
  "Yusuf",
  "Fatima",
  "Kelechi",
  "Adaeze",
  "Obinna",
  "Zainab",
  "Segun",
  "Chinwe",
  "Uche",
  "Aisha",
  "Kunle",
  "Ada",
  "Musa",
  "Blessing",
  "Ibrahim",
  "Halima",
  "Femi",
  "Nneka",
  "Chuka",
  "Damilola",
  "Grace",
]
const L = [
  "Okeke",
  "Adeyemi",
  "Balogun",
  "Okonkwo",
  "Eze",
  "Bello",
  "Nwosu",
  "Abubakar",
  "Ojo",
  "Danjuma",
  "Ibrahim",
  "Chukwu",
  "Mohammed",
  "Adebayo",
  "Okafor",
  "Yakubu",
  "Lawal",
  "Obi",
  "Sani",
  "Uche",
  "Oluwaseun",
  "Aliyu",
  "Nnamdi",
  "Kalu",
  "Effiong",
  "Musa",
  "Onyeka",
  "Adewale",
]

const TYPES: TxnType[] = ["buy", "sell", "send", "swap", "receive", "ticket"]
const TSTAT: TxnStatus[] = [
  "settled",
  "settled",
  "settled",
  "pending_settlement",
  "failed",
  "refunded",
  "quoted",
  "initiated",
]

/**
 * The 26-row transactions dataset — logic.js `seed()` transactions loop (lines 46-73),
 * reproduced deterministically so this list shows the exact same values as the design.
 */
const TXNS: MockTxn[] = Array.from({ length: 26 }, (_, i) => {
  const name = F[i % F.length] + " " + L[i % L.length]
  const userId = "usr_" + (10480 + (i % F.length) * 7)
  const type = TYPES[i % TYPES.length]
  const r = rnd(i + 21)
  let status = TSTAT[i % TSTAT.length]
  if (i === 4 || i === 11 || i === 18) status = "pending_settlement"
  if (i === 7 || i === 16) status = "failed"
  const asset = type === "swap" ? "USDT→TRX" : i % 3 === 0 ? "TRX" : "USDT"
  const usdt = Math.round((5 + r * 480) * 1e6) / 1e6
  const rate = 1064.6887
  const amountNgn = Math.round(usdt * rate * 100) / 100
  return {
    id: "tx_" + (80231 + i * 13),
    type,
    user: name,
    userId,
    asset,
    usdt,
    ngn: amountNgn,
    rate,
    status,
    flwRef: "MockFLWRef-" + (902344 + i * 17),
    chainHash:
      "TJ" +
      String(Math.abs(Math.floor(rnd(i + 31) * 1e15))).padStart(15, "0") +
      "x9",
    idem: "idem_" + Math.abs(Math.floor(rnd(i + 41) * 1e10)).toString(16),
    created:
      "Jul 1 · " +
      String(9 + (i % 9)).padStart(2, "0") +
      ":" +
      String((i * 7) % 60).padStart(2, "0"),
  }
})

// Type-icon `path` data — logic.js `typeIcon` (vTxns, line 688).
const TYPE_ICON: Record<TxnType, string> = {
  buy: "M4 8h13l-3-3",
  sell: "M20 16H7l3 3",
  send: "M4 12h13l-4-4M4 12l9 5",
  swap: "M8 7h11l-3-3M16 17H5l3 3",
  receive: "M12 4v13l-4-4",
  ticket: "M4 9h16v6H4z",
}

// The status-pill label for the tx-list `stMeta` (logic.js vTxns line 687): note the
// list uses "Pending settle" for pending_settlement and folds `receive` → Settled.
const ST_LABEL: Record<TxnStatus, string> = {
  settled: "Settled",
  pending_settlement: "Pending settle",
  failed: "Failed",
  refunded: "Refunded",
  quoted: "Quoted",
  initiated: "Initiated",
  receive: "Settled",
}

// Fold the mock status onto the canonical StatusPill status (receive → success).
const ST_STATUS: Record<TxnStatus, StatusPillStatus> = {
  settled: "settled",
  pending_settlement: "pending_settlement",
  failed: "failed",
  refunded: "refunded",
  quoted: "quoted",
  initiated: "initiated",
  receive: "receive",
}

// View tabs — logic.js `txViews` (vTxns line 691). The `all` tab hides its count.
const TX_VIEWS: { id: TransactionsView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stuck", label: "Stuck / Pending" },
  { id: "failed", label: "Failed today" },
  { id: "refunds", label: "Refunds" },
]

type TransactionsView = "all" | "stuck" | "failed" | "refunds"

/** `filteredTxns()` (logic.js line 661): view + free-text (id/hash/ref/idem) filter. */
function filterTxns(view: TransactionsView, query: string): MockTxn[] {
  const q = query.toLowerCase()
  return TXNS.filter((t) => {
    if (view === "stuck" && t.status !== "pending_settlement") return false
    if (view === "failed" && t.status !== "failed") return false
    if (view === "refunds" && t.status !== "refunded") return false
    if (
      q &&
      !(
        t.id.includes(q) ||
        t.chainHash.toLowerCase().includes(q) ||
        t.flwRef.toLowerCase().includes(q) ||
        t.idem.includes(q)
      )
    )
      return false
    return true
  })
}

/** Per-view count for the tab pills — logic.js `cnt(v)` (vTxns line 690). */
function viewCount(view: TransactionsView): number {
  return TXNS.filter((t) =>
    view === "stuck"
      ? t.status === "pending_settlement"
      : view === "failed"
        ? t.status === "failed"
        : view === "refunds"
          ? t.status === "refunded"
          : true
  ).length
}

const PAGE_SIZE = 10
const MAX_WIDTH = "1360px"
// The design table grid — logic.js Txns.html line 10/13.
const GRID = "grid-cols-[1.1fr_0.8fr_1.3fr_1.1fr_1fr_1.4fr_0.9fr]"

export function TransactionsPage() {
  const router = useRouter()
  const [view, setView] = useState<TransactionsView>("all")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  const rows = useMemo(() => filterTxns(view, search), [view, search])
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function selectView(next: TransactionsView) {
    setView(next)
    setPage(1)
  }

  function onSearch(value: string) {
    setSearch(value)
    setPage(1)
  }

  return (
    <div className="mx-auto max-w-[1360px] px-[30px] pt-[26px] pb-[60px]">
      {/* Header (Txns.html line 3) */}
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold tracking-[-0.02em]">
          Transactions
        </h1>
        <p className="mt-[5px] text-[13.5px] text-ink2">
          Master ledger of activity across buy, sell, send, swap, receive &amp;
          ticket.
        </p>
      </div>

      {/* View tabs + search (Txns.html lines 4-8) */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        {TX_VIEWS.map((v) => {
          const active = view === v.id
          const count = v.id === "all" ? 0 : viewCount(v.id)
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => selectView(v.id)}
              aria-pressed={active}
              className={cn(
                "flex h-9 items-center gap-[7px] rounded-[10px] border px-3.5 text-[12.5px] font-bold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                active
                  ? "border-btn-dark bg-btn-dark text-white"
                  : "border-line bg-card text-ink2 hover:bg-hov"
              )}
            >
              {v.label}
              {count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px text-[10px] tabular-nums",
                    active ? "bg-white/20 text-white" : "bg-swn text-twn"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
        <div className="flex-1" />
        <label className="flex h-9 min-w-[200px] items-center gap-2 rounded-[10px] border border-line bg-card px-3">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className="text-ink3"
          >
            <circle
              cx="11"
              cy="11"
              r="7"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="m20 20-3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="id, hash, ref…"
            aria-label="Search transactions by id, hash or ref"
            className="min-w-0 flex-1 border-none bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink3"
          />
        </label>
      </div>

      {/* Ledger table (Txns.html lines 9-23) */}
      <div className="overflow-hidden rounded-2xl border border-line bg-card">
        {/* Header row */}
        <div
          className={cn(
            "grid gap-3 border-b border-line bg-card2 px-[18px] py-[11px] text-[11px] font-bold tracking-[0.04em] text-ink3 uppercase",
            GRID
          )}
        >
          <div>ID</div>
          <div>Type</div>
          <div>User</div>
          <div className="text-right">Amount</div>
          <div>Status</div>
          <div>Idempotency key</div>
          <div>Created</div>
        </div>

        {rows.length === 0 ? (
          <div className="p-[50px] text-center text-[13px] text-ink3">
            No transactions match this view.
          </div>
        ) : (
          pageRows.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => router.push(`/transactions/${t.id}`)}
              className={cn(
                "grid min-h-[50px] w-full items-center gap-3 border-b border-line2 px-[18px] text-left transition-colors last:border-b-0 hover:bg-hov focus-visible:bg-hov focus-visible:outline-none",
                GRID
              )}
            >
              {/* ID (link-blue mono) */}
              <div className="font-mono text-[12px] font-bold text-tif">
                {t.id}
              </div>
              {/* Type (icon tile + capitalized label) */}
              <div className="flex items-center gap-[7px]">
                <span className="flex size-6 flex-none items-center justify-center rounded-[7px] bg-card2 text-ink2">
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d={TYPE_ICON[t.type]}
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="text-[12px] font-semibold capitalize">
                  {t.type}
                </span>
              </div>
              {/* User */}
              <div className="truncate text-[12px] text-ink2">{t.user}</div>
              {/* Amount (USDT + fiat) */}
              <div className="text-right">
                <div className="font-mono text-[12.5px] font-bold tabular-nums">
                  {t.usdt.toFixed(2)} {t.asset.length > 5 ? "USDT" : t.asset}
                </div>
                <div className="text-[10.5px] text-ink3 tabular-nums">
                  {ngn(t.ngn)}
                </div>
              </div>
              {/* Status pill (pulsing dot when stuck) */}
              <div>
                <StatusPill
                  status={ST_STATUS[t.status]}
                  label={ST_LABEL[t.status]}
                  stuck={t.status === "pending_settlement"}
                />
              </div>
              {/* Idempotency key */}
              <div className="truncate font-mono text-[11px] text-ink3">
                {t.idem}
              </div>
              {/* Created */}
              <div className="text-[11.5px] text-ink2 tabular-nums">
                {t.created}
              </div>
            </button>
          ))
        )}
      </div>

      {rows.length > 0 && (
        <Pagination
          total={rows.length}
          pageSize={PAGE_SIZE}
          page={page}
          onPageChange={setPage}
          maxWidth={MAX_WIDTH}
        />
      )}
    </div>
  )
}
