"use client"

import { cn } from "@/lib/utils"
import type { SettingsDensity } from "@/types"

interface HandleInputProps {
  density: SettingsDensity
  value: string
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
  pending?: boolean
}

/**
 * The design's inline "@handle" entry: a pill input prefixed with `@` and a
 * dark "Add" button. Shared by the PayID claim and the public-nickname add.
 * Enter commits, Escape cancels. Indented to align under the row's text.
 */
export function HandleInput({
  density,
  value,
  onChange,
  onCommit,
  onCancel,
  pending,
}: HandleInputProps) {
  const mobile = density === "mobile"
  return (
    <div
      className={cn(
        "flex gap-2",
        mobile ? "mt-3 ml-[46px]" : "mt-3 ml-[52px] max-w-[400px]"
      )}
    >
      <div
        className={cn(
          "flex flex-1 items-center gap-0.5 rounded-[11px] border border-settings-btn-border bg-card-muted",
          mobile ? "px-[11px]" : "px-3"
        )}
      >
        <span className="mono text-[14px] text-settings-faint">@</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit()
            if (e.key === "Escape") onCancel()
          }}
          placeholder="yourhandle"
          aria-label="Handle"
          autoFocus
          className={cn(
            "mono min-w-0 flex-1 border-none bg-transparent px-1 text-[14px] text-settings-ink outline-none",
            mobile ? "py-[9px]" : "py-2.5"
          )}
        />
      </div>
      <button
        type="button"
        onClick={onCommit}
        disabled={pending}
        className={cn(
          "rounded-[11px] border-none bg-foreground text-[13px] font-semibold text-white disabled:opacity-60",
          mobile ? "px-4 py-[9px]" : "px-[18px] py-2.5"
        )}
      >
        Add
      </button>
    </div>
  )
}
