import type { ReadinessCardProps } from "@/types"

import { ReadinessIcon } from "./provider-icons"

/**
 * The mock→live readiness checklist (design markup lines 14-17) — one check-icon row
 * per gate (done → success tint + check, pending → muted + dash). Each row carries an
 * sr-only done/pending word so colour is never the sole signal.
 */
export function ReadinessCard({ items }: ReadinessCardProps) {
  return (
    <div className="rounded-2xl border border-line bg-card px-5 py-[18px]">
      <div className="mb-3 text-[13px] font-extrabold text-ink">
        Mock → live readiness checklist
      </div>
      {items.length === 0 ? (
        <p className="py-2 text-[12.5px] text-ink3">
          No readiness signals available.
        </p>
      ) : (
        items.map((item) => (
          <div
            key={item.key}
            className="flex items-center gap-[11px] border-b border-line2 py-2 last:border-b-0"
          >
            <span
              aria-hidden="true"
              className={`flex size-5 flex-none items-center justify-center rounded-md ${
                item.done ? "bg-sok text-tok" : "bg-card2 text-ink3"
              }`}
            >
              <ReadinessIcon done={item.done} />
            </span>
            <span className="text-[12.5px] font-semibold text-ink2">
              {item.label}
            </span>
            <span className="sr-only">{item.done ? "done" : "pending"}</span>
          </div>
        ))
      )}
    </div>
  )
}
