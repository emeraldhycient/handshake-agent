import type { ReadOnlyRowProps } from "@/types"

/** One read-only identity row (label + value); role/status are changed only by an admin. */
export function ReadOnlyRow({ label, value, capitalize }: ReadOnlyRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line2 py-[9px] last:border-b-0">
      <dt className="text-[12.5px] text-ink2">{label}</dt>
      <dd
        className={
          capitalize
            ? "text-[12.5px] font-semibold text-ink capitalize"
            : "text-[12.5px] font-semibold text-ink"
        }
      >
        {value}
      </dd>
    </div>
  )
}
