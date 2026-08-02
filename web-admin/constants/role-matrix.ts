import type { AdminPermissionRecord } from "@handshake-agent/contracts"

import type { PermissionMatrixLevel } from "@/types"

/** The actions that count as "elevated" (beyond read) for the full/read split. */
export const ELEVATED_ACTIONS: ReadonlySet<AdminPermissionRecord["action"]> =
  new Set(["write", "execute", "delete"])

/**
 * Access-level → the icon-tile presentation (design line 12 + legend line 14). SVG path
 * `d` per level; tokens map to the same surface/text token pairs as the pills. The level
 * (not colour alone) is the signal — each carries a distinct icon + hover title.
 */
export const LEVEL_META: Record<
  PermissionMatrixLevel,
  { title: string; tile: string; icon: string }
> = {
  full: {
    title: "Full access",
    tile: "bg-sok text-tok",
    icon: "m5 12 5 5L20 7",
  },
  read: {
    title: "Read-only",
    tile: "bg-sif text-tif",
    icon: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z",
  },
  none: {
    title: "No access",
    tile: "bg-card2 text-ink3",
    icon: "M6 6l12 12M18 6L6 18",
  },
}
