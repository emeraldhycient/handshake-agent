import { CornerDownLeft } from "lucide-react"

import { cn } from "@/lib/utils"
import type { CommandResultProps } from "@/types"

/** One result option — label + group subtitle, with the enter glyph on the highlight. */
export function CommandResult({
  dest,
  isActive,
  onActivate,
  onSelect,
}: CommandResultProps) {
  return (
    <li role="presentation">
      <button
        type="button"
        id={`cmdk-opt-${dest.href}`}
        role="option"
        aria-selected={isActive}
        data-active={isActive}
        onMouseMove={onActivate}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-[10px] rounded-xl px-[12px] py-[9px] text-left transition-colors outline-none",
          isActive ? "bg-hov" : "hover:bg-hov"
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-ink">
            {dest.label}
          </span>
          <span className="block truncate text-[11px] font-medium text-ink3">
            {dest.group}
          </span>
        </span>
        {isActive && (
          <CornerDownLeft
            aria-hidden="true"
            className="size-[15px] flex-none text-ink3"
          />
        )}
      </button>
    </li>
  )
}
