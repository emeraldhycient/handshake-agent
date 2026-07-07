import { cn } from "@/lib/utils"
import { KNOB_OFF, KNOB_ON } from "@/constants/flags"
import type { FlagRowProps } from "@/types/components"

/**
 * One flag row — matches the design markup exactly (row card, mono key, desc, rollout
 * chip + `eval →` line, and a 52×30 soft toggle). The toggle is a design-faithful raw
 * track/knob (distinct 52×30 dimensions the shared Switch does not carry), rendered as
 * an accessible switch button.
 */
export function FlagRow({ flag, onToggle }: FlagRowProps) {
  return (
    <div className="flex items-center gap-4 rounded-[16px] border border-line bg-card px-5 py-4">
      {/* ── Flag identity (mono key · desc · rollout chip + eval preview) ────── */}
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[13.5px] font-extrabold text-ink">
          {flag.key}
        </div>
        <div className="mt-[3px] text-[12px] text-ink3">{flag.desc}</div>
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-[6px] bg-card2 px-2 py-0.5 text-[10.5px] font-bold text-ink2">
            {flag.rollout}
          </span>
          <span className="text-[10.5px] text-ink3">
            eval → {flag.on ? "on" : "off"}
          </span>
        </div>
      </div>

      {/* ── Soft toggle (52×30, brand-green track on / card2 off) ────────────── */}
      <button
        type="button"
        role="switch"
        aria-checked={flag.on}
        aria-label={`${flag.on ? "Disable" : "Enable"} ${flag.key}`}
        onClick={() => onToggle(flag)}
        className={cn(
          "relative h-[30px] w-[52px] flex-none rounded-full transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
          flag.on ? "bg-brand-green" : "bg-card2"
        )}
      >
        <span
          aria-hidden="true"
          className="absolute top-[3px] size-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-[left] duration-150"
          style={{ left: flag.on ? KNOB_ON : KNOB_OFF }}
        />
      </button>
    </div>
  )
}
