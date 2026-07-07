/**
 * Audit-log constants (design §6.10). Page size, the shared 6-column grid, the
 * action-filter option set (kept in lock-step with the contract enum), and the filter
 * select className.
 */
import { AuditActionSchema } from "@handshake-agent/contracts"

/** Page size for a single keyset page (design paginated at 6). */
export const PAGE_SIZE = 6

/** Grid template shared by the header row and every body row (design `Audit.html`). */
export const GRID_COLS = "grid-cols-[1.1fr_1fr_1.4fr_1.6fr_1.2fr_0.9fr]"

/** Action-filter options — an "All" sentinel + every contract `AuditAction` value. */
export const ACTION_OPTIONS = [
  { value: "all", label: "All actions" },
  ...AuditActionSchema.options.map((a) => ({ value: a, label: a })),
] as const

/** The design's filter-select className (`--card` surface, 11px radius, 12.5px/600). */
export const FILTER_SELECT_CLASS =
  "h-[38px] w-auto min-w-0 rounded-[11px] border-line bg-card py-0 pr-[30px] pl-3 text-[12.5px] font-semibold"
