/**
 * Ledger viewer constants (design §6.11). The account-type / currency filter axes,
 * the server page size, and the shared filter-select + six-column grid classes.
 */

/**
 * The account-TYPE filter (design's coarse prefix filter). "All" (empty value) omits
 * the `accountType` param → the endpoint browses every account type. The non-empty
 * values are the real `LedgerAccountType` enum (api `06-engine.prisma`).
 */
export const ACCOUNT_OPTIONS = [
  { value: "", label: "All account types" },
  { value: "user_wallet", label: "User wallet" },
  { value: "platform_float", label: "Platform float" },
  { value: "processor_settlement", label: "Processor settlement" },
  { value: "treasury_reserve", label: "Treasury reserve" },
  { value: "clearing", label: "Clearing" },
  { value: "compensation", label: "Compensation" },
] as const

// The currency axis is NOT a constant — options derive from the live catalog
// read (fiats + assets) via `useCurrencyFilterOptions` so runtime-added
// currencies appear without a code change.

/** Server page size for each "Load more" fetch. */
export const PAGE_SIZE = 25

/**
 * Filter-select styling for the 3-column header grid: fill the grid cell, white
 * `--card` surface so the control reads clearly on the cream `--card2` header strip.
 */
export const FILTER_SELECT_CLASS =
  "h-[38px] w-full min-w-0 rounded-[11px] border-line bg-card py-0 pr-[30px] pl-3 text-[12.5px] font-semibold"

/**
 * Six-column grid (Seq · Account · Dir · Amount · Running · Source), shared by the
 * header and every body row so the columns stay aligned.
 */
export const LEDGER_GRID =
  "grid grid-cols-[0.7fr_1.8fr_0.8fr_1.1fr_1.1fr_1fr] gap-3 px-[18px]"
