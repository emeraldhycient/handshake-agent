"use client"

/**
 * ChartBars — the shared stacked-bar volume chart (design §5 "Stacked volume bars",
 * lines 925-941). A 180px-tall flex row of `flex-1` column-reverse bars, each stacking
 * five fixed-colour capability segments (buy → ticket), with 3px end radii and an
 * optional 5-capability legend. Bars are normalised to the tallest total so the
 * chart reads regardless of the input units. Presentation only — no data fetching.
 */
import { cn } from "@/lib/utils"
import type {
  ChartBar,
  ChartBarCapability,
  ChartBarsProps,
} from "@/types/components"

/** The five capability segments, in stacking order, with their fixed design colours. */
const CAPS: readonly {
  key: ChartBarCapability
  label: string
  color: string
}[] = [
  { key: "buy", label: "Buy", color: "#1a4536" },
  { key: "sell", label: "Sell", color: "#2a6f55" },
  { key: "send", label: "Send", color: "#5a9b7a" },
  { key: "swap", label: "Swap", color: "#f5a623" },
  { key: "ticket", label: "Ticket", color: "#e8b96a" },
]

function barTotal(bar: ChartBar): number {
  return CAPS.reduce((sum, c) => sum + bar.segments[c.key], 0)
}

export function ChartBars({
  bars,
  ariaLabel,
  showLegend = true,
}: ChartBarsProps) {
  const peak = bars.reduce((m, b) => Math.max(m, barTotal(b)), 1)

  return (
    <div>
      {showLegend && (
        <div className="mb-2 flex flex-wrap gap-[13px]">
          {CAPS.map((c) => (
            <div key={c.key} className="flex items-center gap-[5px]">
              <span
                aria-hidden
                className="size-[9px] rounded-[3px]"
                style={{ background: c.color }}
              />
              <span className="text-[11px] font-semibold text-ink2">
                {c.label}
              </span>
            </div>
          ))}
        </div>
      )}
      <div
        className="flex h-[180px] items-end gap-[5px]"
        role="img"
        aria-label={ariaLabel}
      >
        {bars.map((bar) => {
          const barPct = Math.max(2, (barTotal(bar) / peak) * 100)
          return (
            <div
              key={bar.label}
              title={bar.label}
              className="flex flex-1 flex-col-reverse justify-start"
              style={{ height: "100%" }}
            >
              {CAPS.map((c, i) => {
                const total = barTotal(bar) || 1
                const segPct = barPct * (bar.segments[c.key] / total)
                return (
                  <div
                    key={c.key}
                    className={cn(
                      i === 0 && "rounded-b-[3px]",
                      i === CAPS.length - 1 && "rounded-t-[3px]"
                    )}
                    style={{ height: `${segPct}%`, background: c.color }}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-ink3">
        <span>{bars[0]?.label ?? ""}</span>
        <span>{bars[bars.length - 1]?.label ?? ""}</span>
      </div>
    </div>
  )
}
