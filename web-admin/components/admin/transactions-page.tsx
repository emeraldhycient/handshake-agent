"use client"

/**
 * TransactionsPage — the master-ledger oversight surface (design §6.8 `pTxns`).
 *
 * PIXEL-FAITHFUL reproduction of `docs/design-ref/screens/Txns.html`: the header +
 * subtitle, the four view tabs (`txViews`), an id/hash/ref search pill, and the
 * 7-column ledger table (ID / Type / User / Amount / Status / Idempotency key /
 * Created) with a pulsing-dot status pill on stuck rows. The rows now come from the
 * REAL engine via `useTransactions(query)` (Phase 6a) — the design's own mock
 * `TXNS[]` const is gone. This surface never executes; it only reads (§3.1).
 *
 * Contract → design mapping (Phase 6b enrichment): `AdminTxnListItem` now carries
 * the itemized amount leg (asset + crypto + fiat), the user's login email (the
 * display name is derived from its local-part — the User model has no name field,
 * §3.4), and the idempotency key (with a copy-on-click affordance). The response
 * carries the four view-tab counts, rendered as count pills. The view tabs drive
 * the single supported `status` filter (+ a from=start-of-day bound for "Failed
 * today"); the search pill is now wired to the backend free-text `q` param
 * (matched server-side across id/hash/ref/idem). Pagination is keyset cursor
 * (`nextCursor`) via a cursor stack — the offset-based `Pagination` primitive does
 * not fit, so a design-tokened Prev/Next pager is used.
 *
 * Rows navigate to the detail route (`/transactions/[id]`).
 */
import { useEffect, useMemo, useState, type MouseEvent } from "react"
import { useRouter } from "next/navigation"

import { cn } from "@/lib/utils"
import { StatusPill } from "@/components/admin/status-pill"
import { Skeleton } from "@/components/ui/skeleton"
import { useTransactions } from "@/lib/query/hooks"
import type {
  AdminTxnListItem,
  AdminTxnSearchQuery,
  AdminTxnStatus,
  AdminTxnViewCounts,
} from "@handshake-agent/contracts"
import type { StatusPillStatus } from "@/types/components"

// ─── Design ⇄ contract mappings ─────────────────────────────────────────────────────

/** Type-icon `path` data — logic.js `typeIcon` (vTxns, line 688). */
const TYPE_ICON: Record<string, string> = {
  buy: "M4 8h13l-3-3",
  sell: "M20 16H7l3 3",
  send: "M4 12h13l-4-4M4 12l9 5",
  swap: "M8 7h11l-3-3M16 17H5l3 3",
  receive: "M12 4v13l-4-4",
  ticket: "M4 9h16v6H4z",
}
/** A neutral fallback glyph for any transaction type the design didn't enumerate. */
const FALLBACK_ICON = "M6 12h12"

/**
 * The engine's `AdminTxnStatus` → the design's `StatusPill` status + label. The BE
 * vocabulary (pending/validating/confirmed/settling/completed/failed/rolled_back/
 * cancelled) is coarser than the design's `stMeta`; this folds it onto the pill's
 * canonical states. In-flight states are "stuck" (pulsing dot) like the design.
 */
const STATUS_META: Record<
  AdminTxnStatus,
  { status: StatusPillStatus; label: string; stuck: boolean }
> = {
  pending: { status: "pending_settlement", label: "Pending", stuck: true },
  validating: {
    status: "pending_settlement",
    label: "Validating",
    stuck: true,
  },
  confirmed: { status: "pending_settlement", label: "Confirmed", stuck: true },
  settling: { status: "pending_settlement", label: "Settling", stuck: true },
  completed: { status: "settled", label: "Settled", stuck: false },
  failed: { status: "failed", label: "Failed", stuck: false },
  rolled_back: { status: "refunded", label: "Refunded", stuck: false },
  cancelled: { status: "initiated", label: "Cancelled", stuck: false },
}

// ─── View tabs ────────────────────────────────────────────────────────────────────

type TransactionsView = "all" | "stuck" | "failed" | "refunds"

// View tabs — logic.js `txViews` (vTxns line 691).
const TX_VIEWS: { id: TransactionsView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stuck", label: "Stuck / Pending" },
  { id: "failed", label: "Failed today" },
  { id: "refunds", label: "Refunds" },
]

/** The single BE `status` filter each view maps onto (the engine takes one status). */
const VIEW_STATUS: Record<TransactionsView, AdminTxnStatus | undefined> = {
  all: undefined,
  stuck: "settling",
  failed: "failed",
  refunds: "rolled_back",
}

/** Start-of-today ISO string — the "Failed today" view's lower bound (`from`). */
function startOfTodayIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

/** The count key each view tab reads from the response's `counts` block. */
const VIEW_COUNT_KEY: Record<TransactionsView, keyof AdminTxnViewCounts> = {
  all: "all",
  stuck: "stuck",
  failed: "failed",
  refunds: "refunds",
}

/** Build the engine search query from the active view + q + cursor (page size 10). */
function buildQuery(
  view: TransactionsView,
  q: string,
  cursor: string | undefined
): AdminTxnSearchQuery {
  const trimmed = q.trim()
  return {
    status: VIEW_STATUS[view],
    from: view === "failed" ? startOfTodayIso() : undefined,
    ...(trimmed ? { q: trimmed } : {}),
    cursor,
    limit: PAGE_SIZE,
  }
}

// ─── User name + amount derivation ────────────────────────────────────────────────

/**
 * A human display name derived from the user's login email local-part (the User
 * model has no name field, §3.4) — e.g. "amara.okeke@x.com" → "Amara Okeke".
 * Falls back to a short userId slice when no email is joined.
 */
function displayName(email: string | null, userId: string): string {
  if (!email) return userId.slice(0, 8)
  const local = email.split("@")[0] ?? ""
  const words = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
  return words.length > 0 ? words.join(" ") : userId.slice(0, 8)
}

/**
 * The amount cell: the crypto leg (amount + asset) with the fiat leg beneath, e.g.
 * "10.5 USDT" / "₦16,500.00". Missing legs collapse gracefully to an em dash.
 */
function amountLines(t: AdminTxnListItem): { crypto: string; fiat: string } {
  const crypto =
    t.amount && t.asset
      ? `${t.amount} ${t.asset}`
      : t.amount
        ? t.amount
        : EM_DASH
  const fiat =
    t.fiatAmount && t.fiatCurrency
      ? `${t.fiatCurrency} ${t.fiatAmount}`
      : t.fiatAmount
        ? t.fiatAmount
        : ""
  return { crypto, fiat }
}

const SEARCH_DEBOUNCE_MS = 250

// ─── Formatting ─────────────────────────────────────────────────────────────────────

/** Compact "Jul 1 · 09:42" created stamp from an ISO timestamp. */
function formatCreated(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })
  return `${date} · ${time}`
}

const PAGE_SIZE = 10
const MAX_WIDTH = "1360px"
// The design table grid — logic.js Txns.html line 10/13.
const GRID = "grid-cols-[1.1fr_0.8fr_1.3fr_1.1fr_1fr_1.4fr_0.9fr]"
const EM_DASH = "—"

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

  // The backend now filters by `q` (id/hash/ref/idem) — rows come straight from
  // the response; no client-side re-filtering.
  const rows = data?.items ?? []
  const counts = data?.counts

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

  const pageIndex = cursorStack.length // 1-based page number
  const canPrev = cursorStack.length > 1
  const canNext = Boolean(data?.nextCursor)

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
          const count = counts?.[VIEW_COUNT_KEY[v.id]]
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
              {count !== undefined && (
                <span
                  className={cn(
                    "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-extrabold tabular-nums",
                    active
                      ? "bg-white/20 text-white"
                      : "bg-card2 text-ink3"
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

        {/* Loading — skeleton rows matching the ledger grid. */}
        {isLoading && (
          <div aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "grid min-h-[50px] items-center gap-3 border-b border-line2 px-[18px] last:border-b-0",
                  GRID
                )}
              >
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="ml-auto h-3.5 w-20" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-16" />
              </div>
            ))}
          </div>
        )}

        {/* Error — tokened inline error with a retry affordance. */}
        {isError && (
          <div className="p-[40px] text-center">
            <p className="text-[13px] font-bold text-tdn">
              Couldn&apos;t load transactions
            </p>
            <p className="mt-1 text-[12px] text-ink3">
              The engine oversight feed is unavailable right now.
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 inline-flex h-8 items-center rounded-[9px] border border-line bg-card px-3.5 text-[12px] font-bold text-ink2 transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty — design-consistent empty state. */}
        {isSuccess && rows.length === 0 && (
          <div className="p-[50px] text-center text-[13px] text-ink3">
            {search.trim()
              ? "No transactions match this search."
              : "No transactions match this view."}
          </div>
        )}

        {/* Data. */}
        {isSuccess &&
          rows.map((t) => (
            <TxnRow
              key={t.id}
              txn={t}
              onOpen={() => router.push(`/transactions/${t.id}`)}
            />
          ))}
      </div>

      {/* Keyset Prev / Next pager — the offset `Pagination` primitive needs a total
          the cursor feed doesn't provide, so this is a design-tokened equivalent. */}
      {isSuccess && rows.length > 0 && (canPrev || canNext) && (
        <nav
          aria-label="Pagination"
          className="mx-auto mt-2 flex items-center justify-between gap-3 border-t border-line2 px-1 pt-3"
          style={{ maxWidth: MAX_WIDTH }}
        >
          <span className="text-xs text-ink3 tabular-nums">
            Page {pageIndex}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={goPrev}
              disabled={!canPrev}
              aria-label="Previous page"
              className={cn(
                "h-8 rounded-[9px] border border-line bg-card px-3 text-xs font-bold text-ink2 transition-colors hover:bg-hov focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                !canPrev && "pointer-events-none opacity-45"
              )}
            >
              Prev
            </button>
            <button
              type="button"
              onClick={goNext}
              disabled={!canNext}
              aria-label="Next page"
              className={cn(
                "h-8 rounded-[9px] border border-line bg-card px-3 text-xs font-bold text-ink2 transition-colors hover:bg-hov focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                !canNext && "pointer-events-none opacity-45"
              )}
            >
              Next
            </button>
          </div>
        </nav>
      )}
    </div>
  )
}

// ─── Row ────────────────────────────────────────────────────────────────────────────

function TxnRow({
  txn,
  onOpen,
}: {
  txn: AdminTxnListItem
  onOpen: () => void
}) {
  const meta = STATUS_META[txn.status]
  const [copied, setCopied] = useState(false)
  const { crypto, fiat } = amountLines(txn)
  const name = displayName(txn.userEmail, txn.userId)

  function copyIdem(e: MouseEvent) {
    e.stopPropagation()
    void navigator.clipboard?.writeText(txn.idempotencyKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  // The row is a keyboard-navigable div (not a <button>) so the idempotency-key
  // copy control can be a real nested <button> without invalid interactive nesting.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        "grid min-h-[50px] w-full cursor-pointer items-center gap-3 border-b border-line2 px-[18px] text-left transition-colors last:border-b-0 hover:bg-hov focus-visible:bg-hov focus-visible:outline-none",
        GRID
      )}
    >
      {/* ID (link-blue mono) */}
      <div className="truncate font-mono text-[12px] font-bold text-tif">
        {txn.id}
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
              d={TYPE_ICON[txn.type] ?? FALLBACK_ICON}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="text-[12px] font-semibold capitalize">{txn.type}</span>
      </div>
      {/* User — display name derived from the joined login email (§3.4). */}
      <div className="min-w-0">
        <div className="truncate text-[12px] font-semibold text-ink">{name}</div>
        <div className="truncate font-mono text-[10.5px] text-ink3">
          {txn.userEmail ?? txn.userId}
        </div>
      </div>
      {/* Amount (crypto leg + fiat leg beneath) */}
      <div className="text-right tabular-nums">
        <div className="text-[12px] font-semibold text-ink">{crypto}</div>
        {fiat && <div className="text-[10.5px] text-ink3">{fiat}</div>}
      </div>
      {/* Status pill (pulsing dot when in-flight) */}
      <div>
        <StatusPill
          status={meta.status}
          label={meta.label}
          stuck={meta.stuck}
        />
      </div>
      {/* Idempotency key — copy-on-click. */}
      <button
        type="button"
        onClick={copyIdem}
        aria-label="Copy idempotency key"
        className="flex min-w-0 items-center gap-1.5 truncate text-left font-mono text-[11px] text-ink3 transition-colors hover:text-ink2 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="truncate">
          {copied ? "Copied" : txn.idempotencyKey}
        </span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className="flex-none"
        >
          <path d="M9 9h10v10H9zM5 15V5h10" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>
      {/* Created */}
      <div className="text-[11.5px] text-ink2 tabular-nums">
        {formatCreated(txn.createdAt)}
      </div>
    </div>
  )
}
