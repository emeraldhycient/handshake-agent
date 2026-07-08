import { formatCryptoAmount } from "@/lib/format"
import { pushToast } from "@/lib/store/toast-store"
import { Panel } from "@/components/admin/user-detail/panel"
import type { UdWalletsTabProps } from "@/types/components"

/**
 * The Wallets tab — real balances rendered as cards (the first is the hero gradient)
 * and the per-network child deposit addresses (click to copy). The Manual credit
 * button opens the engine-brokered four-eyes credit flow (§3.1) owned by the
 * orchestrator — this view only surfaces the entry point.
 */
export function WalletsTab({
  balances,
  depositAddresses,
  onManualCredit,
}: UdWalletsTabProps) {
  // Real balances → wallet cards; the design's ≈Total(NGN) tile has no fiat source,
  // so it is only shown when a fiat balance exists (else omitted — see shapeGaps).
  const walletCards = balances.map((b, i) => ({
    label: `${b.asset} · ${b.network}`,
    avail: b.amount,
    pending: b.pending,
    hero: i === 0,
  }))

  return (
    <div className="flex flex-col gap-3.5">
      {walletCards.length === 0 ? (
        <div className="rounded-2xl border border-line bg-card px-[18px] py-8 text-center text-[12.5px] text-ink3">
          No wallet balances for this user.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {walletCards.map((w) => (
            <div
              key={w.label}
              className="rounded-2xl border p-[16px_18px]"
              style={{
                background: w.hero
                  ? "linear-gradient(150deg,#1a4536,#0e241c)"
                  : "var(--card)",
                borderColor: w.hero ? "transparent" : "var(--line)",
                color: w.hero ? "#fff" : "var(--ink)",
              }}
            >
              <div
                className="text-xs font-semibold"
                style={{
                  color: w.hero ? "rgba(214,226,219,0.65)" : "var(--ink3)",
                }}
              >
                {w.label}
              </div>
              <div className="mt-[5px] font-mono text-[22px] font-extrabold tabular-nums">
                {formatCryptoAmount(w.avail)}
              </div>
              <div
                className="mt-[3px] text-[11.5px] tabular-nums"
                style={{
                  color: w.hero ? "rgba(214,226,219,0.65)" : "var(--ink3)",
                }}
              >
                available
                {w.pending !== null && (
                  <span className="ml-1.5">
                    · {formatCryptoAmount(w.pending)} pending
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <Panel>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[13px] font-extrabold">
            On-chain deposit addresses{" "}
            <span className="font-semibold text-ink3">· child addresses</span>
          </div>
          <button
            type="button"
            onClick={onManualCredit}
            className="flex cursor-pointer items-center gap-[7px] rounded-[10px] border border-line bg-card px-[13px] py-2 text-[12.5px] font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Manual credit
          </button>
        </div>
        {/* Real per-network child deposit addresses from the aggregate. */}
        {depositAddresses.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-ink3">
            No provisioned deposit addresses yet.
          </div>
        ) : (
          depositAddresses.map((a) => (
            <button
              key={a.network + a.address}
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(a.address)
                pushToast(`Copied · ${a.address}`, "copy")
              }}
              className="flex w-full items-center gap-3 border-b border-line2 py-3 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span className="rounded-md bg-card2 px-2 py-[3px] text-[10.5px] font-bold text-ink2">
                {a.network}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
                {a.address}
              </span>
              <span className="text-[10.5px] font-bold text-ink3 capitalize">
                {a.status}
              </span>
            </button>
          ))
        )}
      </Panel>
    </div>
  )
}
