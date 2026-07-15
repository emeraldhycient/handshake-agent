"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { HandleInputProps } from "@/types"

/**
 * The design's inline "@handle" entry: a pill input prefixed with `@` and a
 * dark "Add" button. Shared by the PayID claim and the public-nickname add.
 * Enter commits (unless pending), Escape cancels. Indented to align under the
 * row's text. Focus is shown on the pill wrapper (the input's own outline is
 * suppressed to keep the seamless pill look).
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
          "flex flex-1 items-center gap-0.5 rounded-[11px] border border-settings-btn-border bg-card-muted focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",
          mobile ? "px-[11px]" : "px-3"
        )}
      >
        <span className="mono text-[14px] text-settings-faint">@</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !pending) onCommit()
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
      <Button
        type="button"
        size="lg"
        onClick={onCommit}
        disabled={pending}
        className="flex-none"
      >
        Add
      </Button>
    </div>
  )
}
