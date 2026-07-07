import type { LedgerIntegrityPillProps } from "@/types/components"

/**
 * The header's live sequence-integrity pill: success-tinted "OK" (or "checking") vs.
 * a danger-tinted "Sequence gap" — the icon + label carry the meaning, not colour alone.
 */
export function LedgerIntegrityPill({
  broken,
  label,
}: LedgerIntegrityPillProps) {
  return (
    <div
      className={`flex h-[34px] items-center gap-[9px] rounded-full px-[13px] text-[11.5px] font-bold ${
        broken ? "bg-sdn text-tdn" : "bg-sok text-tok"
      }`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <path
          d={broken ? "M12 9v4m0 4h.01" : "m5 12 5 5L20 7"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </div>
  )
}
