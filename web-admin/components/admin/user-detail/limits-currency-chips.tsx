import type { UdLimitsCurrencyChipsProps } from "@/types"

/**
 * The Limits tab's fiat-scope chip row — one chip per catalog fiat; the active
 * chip is the operator's selection, else the response's own (server-default)
 * currency. Renders nothing when the catalog offers fewer than two fiats.
 */
export function LimitsCurrencyChips({
  options,
  active,
  onSelect,
}: UdLimitsCurrencyChipsProps) {
  if (options.length < 2) return null
  return (
    <div
      role="group"
      aria-label="Limits currency"
      className="mb-3.5 flex flex-wrap gap-1.5"
    >
      {options.map((code) => {
        const isActive = code === active
        return (
          <button
            key={code}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(code)}
            className={`cursor-pointer rounded-full border px-3 py-1 text-[11.5px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
              isActive
                ? "border-btn-dark bg-btn-dark text-white"
                : "border-line bg-card text-ink2 hover:bg-hov"
            }`}
          >
            {code}
          </button>
        )
      })}
    </div>
  )
}
