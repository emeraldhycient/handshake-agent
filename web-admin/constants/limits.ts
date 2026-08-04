/**
 * Limits & velocity constants (design §6). The edit-pencil path, the no-key placeholder
 * for an unenforced cap (no editor — §3.6), and the three NGN KYC tiers.
 */
import type { LimitTierId } from "@/types"

/** The design's edit pencil (logic.js `editIcon`-shaped path); reused per editable row. */
export const EDIT_ICON =
  "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"

/** Placeholder for a row whose cap the engine does not yet enforce (no editor — §3.6). */
export const NO_KEY = "—"

/** The three KYC tiers the registry enumerates (`limits.<currency>.<tier>.*`). */
export const TIER_META: readonly { id: LimitTierId; label: string }[] = [
  { id: "tier_1", label: "Tier 1" },
  { id: "tier_2", label: "Tier 2" },
  { id: "tier_3", label: "Tier 3" },
]
