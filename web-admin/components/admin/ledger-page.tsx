"use client"

/**
 * LedgerPage — the GLOBAL double-entry ledger viewer (design §6.11). Composition only:
 * `useLedgerViewer` owns the account-type + currency filters, the keyset global read,
 * the CSV export, and the integrity-pill derivation; the pill, table, and row live in
 * `components/admin/ledger/*`. Read-only (§3.1) — nothing here moves money. Four async
 * branches; a keyset "Load more" pages beyond the first slice.
 */
import { LedgerIntegrityPill } from "@/components/admin/ledger/ledger-integrity-pill"
import { LedgerTable } from "@/components/admin/ledger/ledger-table"
import { useLedgerViewer } from "@/lib/hooks/use-ledger-viewer"

export function LedgerPage() {
  const l = useLedgerViewer()

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
        <LedgerIntegrityPill broken={l.pill.broken} label={l.pill.label} />
      </div>

      {/* ── Table — filters live in its header strip (3-in-a-row grid) ──────── */}
      <LedgerTable
        account={l.account}
        currency={l.currency}
        onAccount={l.setAccount}
        onCurrency={l.setCurrency}
        currencyOptions={l.currencyOptions}
        exporting={l.exporting}
        onExport={() => void l.exportLedger()}
        isLoading={l.ledger.isLoading}
        isError={l.ledger.isError}
        rows={l.rows}
        onRetry={() => void l.ledger.refetch()}
      />

      {/* ── Keyset "Load more" (server-side cursor, newest-first) ────────────── */}
      {!l.ledger.isLoading && !l.ledger.isError && l.ledger.hasNextPage && (
        <div className="mt-[14px] flex justify-center">
          <button
            type="button"
            onClick={() => l.ledger.fetchNextPage()}
            disabled={l.ledger.isFetchingNextPage}
            className="flex h-[38px] items-center rounded-[11px] border border-line bg-card px-[16px] text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
          >
            {l.ledger.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  )
}
