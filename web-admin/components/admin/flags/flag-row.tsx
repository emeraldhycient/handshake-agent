import { cn } from "@/lib/utils"
import { KNOB_OFF, KNOB_ON } from "@/constants/flags"
import type { FlagRowProps } from "@/types"

/**
 * One flag row — row card, mono key, desc. A REGISTRY-BACKED flag renders its scope
 * chip, the real `eval →` preview, and a 52×30 soft toggle (design-faithful raw
 * track/knob rendered as an accessible switch button). An UNBACKED flag renders a
 * read-only "Not yet wired" pill instead — no switch, no fabricated eval/rollout.
 */
export function FlagRow({ flag, onToggle }: FlagRowProps) {
  const wired = Boolean(flag.settingKey)
  return (
    <div className="flex items-center gap-4 rounded-[16px] border border-line bg-card px-5 py-4">
      {/* ── Flag identity (mono key · desc · scope chip + eval preview) ─────── */}
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[13.5px] font-extrabold text-ink">
          {flag.key}
        </div>
        <div className="mt-[3px] text-[12px] text-ink3">{flag.desc}</div>
        {wired && (
          <div className="mt-2 flex items-center gap-2">
            {flag.rollout && (
              <span className="rounded-[6px] bg-card2 px-2 py-0.5 text-[10.5px] font-bold text-ink2">
                {flag.rollout}
              </span>
            )}
            <span className="text-[10.5px] text-ink3">
              eval → {flag.on ? "on" : "off"}
            </span>
          </div>
        )}
      </div>

      {wired ? (
        /* ── Soft toggle (52×30, brand-green track on / card2 off) ──────────── */
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
      ) : (
        /* ── Honest read-only state: no backing config key exists yet ───────── */
        <span className="flex-none rounded-full bg-card2 px-3 py-1 text-[10.5px] font-bold text-ink3">
          Not yet wired
        </span>
      )}
    </div>
  )
}
