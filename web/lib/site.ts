/**
 * Site-wide identity + SEO/PWA config (single source of truth).
 *
 * Public URL is layered config (root CLAUDE.md §7 — infra/public URL → env):
 * `NEXT_PUBLIC_SITE_URL` in production, a localhost default for dev. It feeds
 * `metadataBase`, canonical URLs, the sitemap/robots hosts, and the install QR.
 *
 * Hex colours here are DATA, not theme tokens (§13.1 — literals belong in lib/,
 * never in components). The web app's colour system is oklch in globals.css; the
 * web app manifest and `<meta name=theme-color>` require plain hex, so the brand
 * hexes are pinned here to match the oklch tokens (values annotated in globals.css).
 */

/** Full product name — used in <title>, OG, manifest `name`, JSON-LD. */
export const SITE_NAME = "Handshake Agent"

/** Short name — home-screen label under the installed icon (manifest `short_name`). */
export const SITE_SHORT_NAME = "Handshake"

/** One-line marketing description — meta description, OG, manifest. */
export const SITE_DESCRIPTION =
  "Buy, sell, send and receive crypto and discover event tickets — all through a chat you can talk to. The chat-native money app for a borderless world."

/** Terse tagline for OG cards and the install screen. */
export const SITE_TAGLINE = "Chat-native crypto & payments, across borders"

/**
 * Brand colours as hex (manifest + theme-color meta need hex, not oklch).
 * Mirror the oklch tokens in `app/globals.css` (annotations there give the hex).
 */
export const BRAND = {
  /** primary green — browser toolbar / status-bar tint (manifest theme_color). */
  themeColor: "#1a4536",
  /** deep green — dark-scheme theme colour. */
  themeColorDark: "#0e241c",
  /** cream — app background; drives the splash background for a seamless launch. */
  backgroundColor: "#f3efe7",
  /** accent orange — the brand mark tile. */
  accent: "#f5a623",
  /** accent deep — gradient end of the mark tile. */
  accentDeep: "#e8961a",
  /** deep green — the mark's dark centre + icon tile background. */
  greenDeep: "#0e241c",
} as const

/**
 * QR colours — functional DATA (must stay high-contrast for scanners), not theme
 * tokens. Brand-dark on white scans reliably across devices.
 */
export const QR_COLORS = {
  foreground: BRAND.greenDeep,
  background: "#ffffff",
} as const

/**
 * Resolve the site origin, normalised without a trailing slash.
 * Read at call time so server components pick up runtime env and the client
 * bundle inlines the `NEXT_PUBLIC_` value at build.
 */
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  return raw.replace(/\/+$/, "")
}

/** Build an absolute URL from a path (canonical links, OG, sitemap, QR). */
export function absoluteUrl(path = ""): string {
  if (!path) return getSiteUrl()
  const suffix = path.startsWith("/") ? path : `/${path}`
  return `${getSiteUrl()}${suffix}`
}
