/**
 * The service worker's per-request caching decision, as a pure function so it can
 * be unit-tested. `public/sw.js` mirrors these exact rules at runtime (it cannot
 * import this module — a classic worker has no bundler — so keep the two in sync).
 *
 * Safety first (root CLAUDE.md §3): the /api guard means the SW NEVER caches an
 * authenticated or money-moving request, even when the API is served same-origin
 * under /api. Cross-origin and non-GET requests are left entirely to the browser.
 */
export type SwStrategy =
  | "passthrough" // do not intercept — browser handles it
  | "network-only" // fetch fresh every time, never cache
  | "network-first" // try network, fall back to cache (then offline shell)
  | "cache-first" // serve from cache, revalidate in the background

export interface SwRequestInfo {
  method: string
  sameOrigin: boolean
  pathname: string
  isNavigate: boolean
}

const STATIC_EXT =
  /\.(?:js|css|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot)$/i

const STATIC_PREFIX = ["/_next/static/", "/icons/", "/fonts/", "/og/"]

export function resolveStrategy(req: SwRequestInfo): SwStrategy {
  if (req.method !== "GET") return "passthrough"
  if (!req.sameOrigin) return "passthrough"
  // Auth/chat/wallet — anything under /api — is never cached, even same-origin.
  if (req.pathname === "/api" || req.pathname.startsWith("/api/")) {
    return "network-only"
  }
  if (req.isNavigate) return "network-first"
  if (
    STATIC_PREFIX.some((p) => req.pathname.startsWith(p)) ||
    req.pathname === "/manifest.webmanifest" ||
    STATIC_EXT.test(req.pathname)
  ) {
    return "cache-first"
  }
  return "network-first"
}
