/**
 * Currency-catalog constants (design §6.24). The 5-column table grid — verbatim from
 * the markup (grid-template-columns:1.4fr 0.8fr 0.8fr 1fr 0.9fr): Currency / Symbol /
 * Rounding / Name-enquiry / Live.
 */
export const CURRENCY_GRID = "grid-cols-[1.4fr_0.8fr_0.8fr_1fr_0.9fr]"

/**
 * The fiat used to pin a currency list's sort order / seed a currency selector
 * before `/config` (`usePublicConfig`) has resolved — the offline/code-defaults
 * fallback (root CLAUDE.md §7). The live source of truth is always the first
 * enabled fiat in the `/config` catalog; callers should prefer that over this
 * constant once the query has data.
 */
export const DEFAULT_DISPLAY_FIAT = "NGN"
