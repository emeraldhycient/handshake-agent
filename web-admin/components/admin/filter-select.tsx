"use client"

/**
 * FilterSelect — the shared filter dropdown (design select §5, lines 219 / 470 /
 * 1031). Wraps the canonical `NativeSelect` primitive with an accessible label (the
 * design's filter selects have no visible label, so it becomes `aria-label`) and a
 * declarative `options` list, so every screen's filter row composes the same control.
 */
import { NativeSelect } from "@/components/ui/native-select"
import type { FilterSelectProps } from "@/types"

export function FilterSelect({ label, options, ...props }: FilterSelectProps) {
  return (
    <NativeSelect aria-label={label} {...props}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  )
}
