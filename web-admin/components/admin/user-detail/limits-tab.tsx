import { Skeleton } from "@/components/ui/skeleton"
import { Panel } from "@/components/admin/user-detail/panel"
import { VelocityBar } from "@/components/admin/user-detail/velocity-bar"
import { fmtFiat, usagePct } from "@/lib/users/user-detail"
import type { UdLimitsTabProps } from "@/types/components"

/**
 * The Limits tab: the effective per-tier caps (resolved from the layered config) and
 * the live velocity usage (fiat-used-vs-cap, tx-count-vs-cap), each with four async
 * branches. Read-only — enforcement is server-side (§3.3).
 */
export function LimitsTab({ tier, query, onRetry }: UdLimitsTabProps) {
  if (query.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3.5" aria-busy="true">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    )
  }
  if (query.isError || !query.data) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-sdn bg-sdn/40 p-5">
        <span className="text-[12.5px] font-bold text-tdn">
          Failed to load limits & velocity.
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="cursor-pointer rounded-[9px] border border-line bg-card px-[13px] py-2 text-xs font-bold text-ink transition-colors hover:bg-hov focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Retry
        </button>
      </div>
    )
  }

  const { effectiveLimits, velocity } = query.data
  const fiat = effectiveLimits?.fiatCurrency ?? null

  // Effective-cap rows — null when the user is unverified (no tier caps apply).
  const limitRows = effectiveLimits
    ? [
        {
          k: "Per-transaction cap",
          v: fmtFiat(effectiveLimits.perTxFiatMax, fiat),
        },
        { k: "Daily cap", v: fmtFiat(effectiveLimits.dailyFiatMax, fiat) },
        {
          k: "Tx count / day",
          v: String(effectiveLimits.dailyTxCountMax),
        },
      ]
    : []

  // Velocity rows — fiat used vs daily cap, and tx count vs daily count cap.
  const fiatPct = effectiveLimits
    ? usagePct(velocity.dailyFiatUsed, effectiveLimits.dailyFiatMax)
    : "0%"
  const countPct = effectiveLimits
    ? usagePct(
        String(velocity.dailyTxCount),
        String(effectiveLimits.dailyTxCountMax)
      )
    : "0%"

  return (
    <div className="grid grid-cols-2 items-start gap-3.5">
      <Panel>
        <div className="mb-1 text-[13px] font-extrabold">
          Effective limits · {tier}
        </div>
        <div className="mb-3.5 text-[11.5px] text-ink3">
          Per-tier caps resolved from the layered config.
        </div>
        {limitRows.length === 0 ? (
          <div className="py-4 text-center text-[12px] text-ink3">
            No tier caps apply — this user is unverified.
          </div>
        ) : (
          limitRows.map((l) => (
            <div
              key={l.k}
              className="flex justify-between gap-3 border-b border-line2 py-[9px]"
            >
              <span className="text-[12.5px] text-ink2">{l.k}</span>
              <span className="font-mono text-[12.5px] font-bold tabular-nums">
                {l.v}
              </span>
            </div>
          ))
        )}
      </Panel>
      <Panel>
        <div className="mb-3.5 text-[13px] font-extrabold">
          Current velocity usage
        </div>
        <VelocityBar
          label="Daily fiat used"
          used={fmtFiat(velocity.dailyFiatUsed, fiat)}
          cap={
            effectiveLimits ? fmtFiat(effectiveLimits.dailyFiatMax, fiat) : "—"
          }
          pct={fiatPct}
        />
        <VelocityBar
          label="Tx count (24h)"
          used={String(velocity.dailyTxCount)}
          cap={effectiveLimits ? String(effectiveLimits.dailyTxCountMax) : "—"}
          pct={countPct}
        />
      </Panel>
    </div>
  )
}
