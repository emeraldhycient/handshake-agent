/**
 * Pricing-console constants (design §6.22). The 7-column spread-grid template, the
 * priced-asset set, and the base-rate key pattern. Kept once so the header row and
 * every body row line up pixel-for-pixel with the markup.
 */

// The design's exact 7-column spread-grid template (Pricing.html).
export const PRICING_GRID = "grid-cols-[1.2fr_1fr_0.8fr_0.8fr_1fr_1.4fr_0.7fr]"

export const PRICED_ASSETS = ["USDT", "BTC", "TRX"] as const

// `pricing.assets.<ASSET>.baseRates.<CCY>` — the per-(asset × currency) base-rate leaf.
export const BASE_RATE_RE =
  /^pricing\.assets\.([A-Za-z0-9]+)\.baseRates\.([A-Z]{3})$/
