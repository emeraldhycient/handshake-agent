import { Check, Eye, X } from "lucide-react"

import type { AccessLevel, AccessTileProps } from "@/types/components"

/** The access-level → label + tile tokens + glyph map (shared by tiles + the legend). */
export const ACCESS_META: Record<
  AccessLevel,
  { label: string; tile: string; Icon: typeof Check }
> = {
  full: { label: "Full access", tile: "bg-sok text-tok", Icon: Check },
  read: { label: "Read-only", tile: "bg-sif text-tif", Icon: Eye },
  none: { label: "No access", tile: "bg-card2 text-ink3", Icon: X },
}

/** One 24px access glyph tile — colour is paired with a title + sr-only label. */
export function AccessTile({ level }: AccessTileProps) {
  const { label, tile, Icon } = ACCESS_META[level]
  return (
    <span
      title={label}
      className={`flex size-6 items-center justify-center rounded-[7px] ${tile}`}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
      <span className="sr-only">{label}</span>
    </span>
  )
}
